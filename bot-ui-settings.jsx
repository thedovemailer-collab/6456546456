// ───────────────────────────────────────────────────────────────────
// bot-ui-settings.jsx — Settings sheet, sub-popups, sidebar, login screen
// Everything around the chrome of the app: the main left rail, the
// Telegram-style settings sheet that replaces the topnav, the login /
// registration screen, and the account chip in the title bar.
//     SField / SOk / SNote / SErr      — settings form primitives
//     ConnectedChip / FInput / ConnectedAccountCard
//     TgAuthModal                      — Telegram OTP / 2FA modal
//     ActiveLlmPicker / AiMasterToggle — Settings → Connections → LLM
//     SettingsView                     — legacy long-form settings page
//     Sidebar + ICONS + SbIco          — left rail
//     SettingsGearButton / SettingsSwitcher / useSettingsPopupCtl
//                                      — the gear in the search field and the
//                                        section circles beside the open window
//     DiagPill / SsetInfo / SsetSeg
//     SettingsSubPanelPopup            — the section window (page tabs + pages)
//         Connections: Accounts / LLM / Filters
//         Agents · Catalog · Licenses & payments
//         Preferences: Appearance / Notifications / General
//     LoginRegister / AccountChip      — auth UI
// ───────────────────────────────────────────────────────────────────

// ── SETTINGS sub-components — defined OUTSIDE SettingsView so React never
// remounts them on re-render (which would steal input focus after each keystroke)
const SField = ({label, children}) => (
  <div style={{display:'flex',flexDirection:'column',gap:6,minWidth:0}}>
    <label style={{fontSize:9.5,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{label}</label>
    {children}
  </div>
);
const SOk = ({label='Connected · Active'}) => (
  <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:'var(--ok)',marginTop:4,padding:'6px 10px',background:'rgba(48,209,88,0.06)',border:'1px solid rgba(48,209,88,0.14)',borderRadius:7}}>
    <Pip col="var(--ok)" sz={6}/><span>{label}</span>
  </div>
);
const SNote = ({warn=false, children}) => (
  <div style={{fontSize:11,color:warn?'rgba(255,200,80,0.85)':'var(--t3)',lineHeight:1.6,padding:'9px 12px',marginTop:10,background:warn?'rgba(255,159,10,0.06)':'rgba(255,255,255,0.025)',borderRadius:7,border:`1px solid ${warn?'rgba(255,159,10,0.2)':'var(--ln)'}`}}>{children}</div>
);
const SErr = ({msg}) => (
  <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11.5,color:'var(--err)',marginTop:4,padding:'6px 10px',background:'rgba(255,69,58,0.06)',border:'1px solid rgba(255,69,58,0.18)',borderRadius:7}}>
    <Pip col="var(--err)" sz={6}/><span>{msg}</span>
  </div>
);

// ── Connected-account chip — compact single-line replacement for
// ConnectedAccountCard, used inside the embedded sub-popup. ──
const ConnectedChip = ({platform, conn, profileMeta, onDisconnect, isWV2}) => {
  const isTg = platform === 'telegram';
  const live = !!conn.connected;
  // If we have a last-known profile but aren't connected yet, it means we're
  // waiting on the status ping — show "Checking…" rather than "Disconnected"
  // so the chip doesn't falsely alarm the operator every time the popup opens.
  const hasCachedProfile = !!(profileMeta && (profileMeta.botName || profileMeta.username));
  const botName = conn.botName || (profileMeta && profileMeta.botName) || (isTg ? 'Telegram bot' : 'Discord bot');
  const username = conn.username || (profileMeta && profileMeta.username) || '';
  const [statusLabel, setStatusLabel] = React.useState(() => {
    if (live) return 'Connected';
    if (hasCachedProfile) return 'Checking…';
    return 'Disconnected';
  });
  React.useEffect(() => {
    if (live) { setStatusLabel('Connected'); return; }
    if (hasCachedProfile) {
      // Give the status ping 2s to come back before showing Disconnected
      const t = setTimeout(() => setStatusLabel('Disconnected'), 2000);
      return () => clearTimeout(t);
    }
    setStatusLabel('Disconnected');
  }, [live, hasCachedProfile]);
  return (
    <div className="sset-conn-chip" data-on={live?'1':'0'}>
      <Pip col={live?'var(--ok)':'var(--t4)'} sz={6} pulse={live}/>
      <span className="sset-conn-name">{botName}</span>
      {username && <><span style={{color:'var(--t4)'}}>·</span><span className="sset-conn-meta">{username}</span></>}
      {!live && <span className="sset-conn-meta" style={{opacity:0.55}}>{statusLabel}</span>}
      <span className="sset-conn-spacer"/>
      {live && (
        <button className="sset-conn-act" onClick={onDisconnect} disabled={!isWV2}>
          Disconnect
        </button>
      )}
    </div>
  );
};

// ── Framed inline input — used inside sub-popup forms. Label is
// inline, optional info icon and reveal button on the right. ──
const FInput = ({label, value, onChange, placeholder, type='text', info, disabled}) => {
  const [show, setShow] = React.useState(false);
  const isPwd = type === 'password';
  const inputType = isPwd && show ? 'text' : type;
  return (
    <div className="sset-finput" data-off={disabled ? '1' : undefined}>
      {label && <span className="sset-finput-lbl">{label}</span>}
      <input
        className="sset-finput-input"
        type={inputType}
        value={value || ''}
        onChange={e=>onChange(e.target.value)}
        placeholder={placeholder}
        disabled={!!disabled}
      />
      {isPwd && (
        <button className="sset-finput-act" type="button" disabled={!!disabled}
          onClick={()=>setShow(s=>!s)}
          aria-label={show?'Hide':'Show'}>
          {show ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
              <line x1="1" y1="1" x2="23" y2="23"/>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
            </svg>
          )}
        </button>
      )}
      {info && <SsetInfo>{info}</SsetInfo>}
    </div>
  );
};

// ── Connected Accounts card — used at top of the Platforms tab so the
// user can see who is connected the moment they open Settings.
const ConnectedAccountCard = ({platform, conn, profileMeta, onDisconnect, isWV2}) => {
  const isTg = platform === 'telegram';
  const Icon = isTg ? TgIcon : DcIcon;
  const liveConnected = !!conn.connected;
  // Show *something* useful even when not currently connected, using last-known
  // profile from CRED_STORE.meta — so the user can verify which account they
  // last connected with.
  const botName = conn.botName || (profileMeta && profileMeta.botName) || (isTg ? 'Telegram bot' : 'Discord bot');
  const username = conn.username || (profileMeta && profileMeta.username) || '';
  const avatar = conn.avatar || (profileMeta && profileMeta.avatar) || '';
  return (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'11px 13px',
      background: liveConnected ? 'rgba(48,209,88,0.05)' : 'rgba(255,255,255,0.02)',
      border: `1px solid ${liveConnected ? 'rgba(48,209,88,0.18)' : 'rgba(255,255,255,0.06)'}`,
      borderRadius: 10,
    }}>
      <div style={{position:'relative', flexShrink:0}}>
        <Ava name={botName} col={isTg?'#2AABEE':'#5865F2'} sz={36} src={avatar}/>
        <span style={{position:'absolute',bottom:-2,right:-2,width:14,height:14,borderRadius:'50%',background:'var(--s1)',display:'flex',alignItems:'center',justifyContent:'center',border:'1px solid var(--ln2)'}}><Icon s={9}/></span>
      </div>
      <div style={{flex:1, minWidth:0}}>
        <div style={{fontSize:12.5, fontWeight:600, color:'var(--t1)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{botName}</div>
        <div style={{fontSize:10.5, color:'var(--t3)', display:'flex', alignItems:'center', gap:6, marginTop:2}}>
          <Pip col={liveConnected?'var(--ok)':'var(--t4)'} sz={5} pulse={liveConnected}/>
          <span>{liveConnected ? 'Connected' : 'Not connected'}</span>
          {username && <span style={{color:'var(--t4)'}}>·</span>}
          {username && <span style={{fontFamily:'var(--mono)'}}>{username}</span>}
        </div>
      </div>
      {liveConnected && (
        <button onClick={onDisconnect} disabled={!isWV2}
          style={{padding:'5px 10px',fontSize:11,fontWeight:600,borderRadius:6,cursor:isWV2?'pointer':'not-allowed',
            background:'rgba(255,69,58,0.12)',color:'var(--err)',border:'1px solid rgba(255,69,58,0.28)',opacity:isWV2?1:0.5}}>
          Disconnect
        </button>
      )}
    </div>
  );
};

// ── TELEGRAM USER-API OTP MODAL ──────────────────────────────
// Shown when .NET fires a "telegramAuthRequired" event. Two phases:
//   kind === 'code'     → user types the OTP from their Telegram app
//   kind === 'password' → user types their 2FA cloud password
// On submit we forward via BotBridge.submitTelegramCode; .NET resolves the
// awaiting Login() call. The modal closes when "telegramStatus.connected"
// fires, or stays open with an error if auth fails.
const TgAuthModal = () => {
  const auth = useTgAuth();
  const [val, setVal] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  // Reset input every time the modal opens or the kind changes (code → password).
  React.useEffect(()=>{ setVal(''); setBusy(false); }, [auth.open, auth.kind]);
  // If .NET reports a fresh error after we submitted, unstick the busy flag.
  React.useEffect(()=>{ if (auth.error) setBusy(false); }, [auth.error]);

  if (!auth.open) return null;
  const isPwd = auth.kind === 'password';
  const submit = () => {
    if (!val.trim() || busy) return;
    setBusy(true);
    if (isPwd) window.BotBridge.submitTelegramCode('', val.trim());
    else        window.BotBridge.submitTelegramCode(val.trim(), '');
  };
  const cancel = () => {
    if (window.BotBridge && window.BotBridge.cancelTelegramAuth) window.BotBridge.cancelTelegramAuth();
    TG_AUTH_STORE.close();
  };

  // TopLayer: the Platforms popup now lives at the page root (z 9710), so
  // this dialog has to as well or it would open underneath it.
  return (
    <TopLayer>
    <div style={{
      position:'fixed',inset:0,zIndex:9999,
      background:'rgba(8,9,16,0.7)',backdropFilter:'blur(6px)',
      display:'flex',alignItems:'center',justifyContent:'center'
    }} onMouseDown={e=>{ if(e.target===e.currentTarget) cancel(); }}>
      <div style={{
        width:380,background:'var(--s2)',border:'1px solid var(--ln2)',
        borderRadius:14,padding:'22px 22px 18px',
        boxShadow:'0 24px 60px rgba(0,0,0,0.55)'
      }}>
        <div style={{fontSize:14,fontWeight:600,color:'var(--t1)',marginBottom:6}}>
          {isPwd ? 'Two-Step Verification' : 'Verification Code'}
        </div>
        <div style={{fontSize:11.5,color:'var(--t2)',marginBottom:14,lineHeight:1.55}}>
          {isPwd
            ? 'Enter your Telegram cloud password (set in Settings → Privacy and Security → Two-Step Verification).'
            : <>Telegram has sent a login code to your account{auth.phone?<> for <strong style={{color:'var(--t1)'}}>{auth.phone}</strong></>:''}. Open your Telegram app and paste the code below.</>}
        </div>
        <input
          autoFocus
          className="fi"
          type={isPwd?'password':'text'}
          inputMode={isPwd?undefined:'numeric'}
          value={val}
          onChange={e=>setVal(e.target.value)}
          onKeyDown={e=>{ if(e.key==='Enter') submit(); if(e.key==='Escape') cancel(); }}
          placeholder={isPwd?'Cloud password':'12345'}
          style={{width:'100%',marginBottom:12,letterSpacing:isPwd?'normal':'0.18em',fontSize:isPwd?13:15,fontFamily:isPwd?'var(--font)':'var(--mono)'}}
        />
        {auth.error && (
          <div style={{fontSize:11.5,color:'var(--err)',marginBottom:12,padding:'7px 10px',background:'rgba(255,69,58,0.08)',border:'1px solid rgba(255,69,58,0.2)',borderRadius:7}}>
            {auth.error}
          </div>
        )}
        <div style={{display:'flex',gap:8,justifyContent:'flex-end'}}>
          <button className="abtn nw" onClick={cancel} disabled={busy}
            style={{background:'rgba(255,255,255,0.04)',color:'var(--t2)',border:'1px solid var(--ln2)'}}>
            Cancel
          </button>
          <button className="abtn nw" onClick={submit} disabled={busy||!val.trim()}
            style={{minWidth:90}}>
            {busy?'Verifying…':isPwd?'Sign in':'Verify'}
          </button>
        </div>
      </div>
    </div>
    </TopLayer>
  );
};

// ── SETTINGS ─────────────────────────────────────────────────
// ── Active-LLM picker (Settings → LLM Keys) ──────────────────
// Custom dropdown — trigger shows the active provider's logo + name; the
// menu is portalled to document.body (so it isn't clipped by .sset-subpop)
// and lists all providers with logos and a "no key entered" disabled state.
const ActiveLlmPicker = ({creds, fld}) => {
  const active = (creds.values && creds.values.llm_active) || '';
  const [open, setOpen] = React.useState(false);
  const [pos, setPos]   = React.useState({left:0, top:0, width:0});
  const triggerRef = React.useRef(null);
  const menuRef    = React.useRef(null);

  // The built-in AI (the site's own key) is listed first while it's offered.
  const cat = typeof useLlmCatalog === 'function' ? useLlmCatalog() : null;
  const bi = typeof llmBuiltin === 'function' ? llmBuiltin(cat) : null;
  const opts = [
    ...((bi || active === 'builtin') ? [{ id:'builtin', label:'Built-in AI', Icon:BuiltinAiIcon, has:!!bi,
      full: bi ? `Built-in AI · ${bi.label || bi.model}` : 'Built-in AI (switched off)' }] : []),
    ...LLM_PROVIDERS.map(p => ({
      ...p,
      has: !!(fld[p.id] || (creds.values || {})[`llm_${p.id}`]),
    })),
  ];
  const activeOpt = opts.find(o => o.id === active) || null;

  const setActive = (id) => {
    apiFetch('set_active_llm', {provider:id}).then((r)=>{
      if (r && r.error) { bcToast(r.error, 'err'); return; }
      CRED_STORE.set('llm_active', id);
    }).catch(()=>bcToast('Network error — the provider was not changed', 'err'));
    setOpen(false);
  };

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

  const Trigger = activeOpt
    ? (
      <span style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
        <activeOpt.Icon s={14}/>
        <span style={{fontSize:11.5,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.005em',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{activeOpt.full}</span>
      </span>
    )
    : (
      <span style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1,color:'#8a8aa8'}}>
        <span style={{width:14,height:14,borderRadius:'50%',background:'rgba(255,255,255,0.05)',border:'1px dashed rgba(255,255,255,0.18)',flexShrink:0}}/>
        <span style={{fontSize:11.5,fontWeight:500}}>Choose active provider…</span>
      </span>
    );

  return (
    <>
      <button ref={triggerRef} type="button" onClick={()=>setOpen(o=>!o)}
        style={{
          width:'100%',display:'flex',alignItems:'center',gap:8,
          padding:'7px 11px',
          background: open ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.03)',
          border:`1px solid ${open ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.08)'}`,
          borderRadius:7,cursor:'pointer',transition:'all 0.12s',textAlign:'left',
        }}>
        {Trigger}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--t3)',transition:'transform 0.16s',transform:open?'rotate(180deg)':'none',flexShrink:0}}><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={menuRef} style={{
          position:'fixed', left:pos.left, top:pos.top, width:pos.width,
          zIndex: 9999,
          padding:5,
          background:'rgba(20,22,42,0.98)',
          backdropFilter:'blur(24px) saturate(170%)',
          WebkitBackdropFilter:'blur(24px) saturate(170%)',
          border:'1px solid rgba(255,255,255,0.10)',
          borderRadius:10,
          boxShadow:'0 16px 48px rgba(0,0,0,0.55), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
          display:'flex',flexDirection:'column',gap:2,
        }}>
          {opts.map(o => {
            const sel = active === o.id;
            return (
              <button key={o.id} type="button" disabled={!o.has}
                onClick={()=>o.has && setActive(o.id)}
                style={{
                  display:'flex',alignItems:'center',gap:8,width:'100%',
                  padding:'6px 9px',border:'none',borderRadius:6,textAlign:'left',
                  background: sel ? 'rgba(255,255,255,0.07)' : 'transparent',
                  cursor: o.has ? 'pointer' : 'not-allowed',
                  opacity: o.has ? 1 : 0.55,
                  transition:'background 0.10s',
                }}
                onMouseEnter={e=>{ if(o.has && !sel) e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}
                onMouseLeave={e=>{ if(o.has && !sel) e.currentTarget.style.background='transparent'; }}>
                <o.Icon s={14}/>
                <span style={{flex:1,fontSize:11.5,fontWeight:500,color:'var(--t1)',letterSpacing:'-0.005em'}}>{o.full}</span>
                {!o.has && <span style={{fontSize:9,color:'#8a8aa8',fontStyle:'italic'}}>{o.id === 'builtin' ? 'off' : 'no key'}</span>}
                {sel && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.7)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
              </button>
            );
          })}
        </div>,
        document.body
      )}
    </>
  );
};

// ── Master AI toggle (Settings → General → AI Engine) ────────
// Persists to credential `ai_enabled` ('1'|'0'). The reply queue and the
// server-side ai_reply endpoint both check this — flipping it OFF instantly
// silences every agent in every conversation without un-pairing anything.
const AiMasterToggle = () => {
  const enabled = useAiMaster();
  const [busy, setBusy] = React.useState(false);
  const flip = () => {
    setBusy(true);
    AI_MASTER.set(!enabled).finally(()=>setBusy(false));
    console.log('[ai-master] toggled →', !enabled ? 'ENABLED' : 'DISABLED');
  };
  // Master switch for every auto-reply. Off still receives and saves
  // messages; it just never calls the model or sends anything.
  return (
    <div className="bc-card ag-master" data-off={enabled ? undefined : '1'}
      style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',cursor:busy?'wait':'pointer'}}
      role="switch" aria-checked={enabled} tabIndex={0} aria-label="Agents reply to customers"
      onClick={()=>{ if (!busy) flip(); }}
      onKeyDown={e=>{ if (!busy && (e.key===' '||e.key==='Enter')) { e.preventDefault(); flip(); } }}>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12.5,fontWeight:500,color:'var(--t1)',lineHeight:1.25}}>
          {enabled ? 'Agents are replying' : 'All agents are paused'}
        </div>
        <div style={{fontSize:10.5,color:'#8a8aa8',lineHeight:1.35,marginTop:2}}>
          {enabled ? 'Turn off to pause every agent at once.' : 'Messages still arrive. Nobody replies until you turn this back on.'}
        </div>
      </div>
      <span className="bc-switch" data-on={enabled ? '1' : '0'} aria-hidden="true" style={{opacity:busy?0.5:1}}/>
    </div>
  );
};

const SettingsView = ({_embedTab} = {}) => {
  const [tab,     setTab]     = React.useState(_embedTab || 'platforms');
  const [tgMode,  setTgMode]  = React.useState('bot');
  const [platSel, setPlatSel] = React.useState('telegram');
  const [saved,   setSaved]   = React.useState('');
  const [tgBusy,  setTgBusy]  = React.useState(false);
  const [dcBusy,  setDcBusy]  = React.useState(false);

  // Connection state from CONN_STORE — survives Settings unmount/remount.
  const [tgConn, dcConn] = useConn();

  // Persisted credentials. fld is a *local mirror* of CRED_STORE for input
  // editing — saved back via CRED_STORE.set on change so refresh survives.
  const creds = useCreds();
  const [fld, setFld] = React.useState({
    tgToken:'', tgApiId:'', tgApiHash:'', tgPhone:'',
    dc:'', gemini:'', openai:'', claude:''
  });
  // Hydrate fld whenever credentials load/change. We only push from store→fld
  // when the local field is empty so the user's typing isn't overwritten by
  // an in-flight refresh.
  React.useEffect(()=>{
    setFld(prev=>({
      tgToken:  prev.tgToken  || creds.values.tg_bot_token || '',
      tgApiId:  prev.tgApiId  || creds.values.tg_api_id    || '',
      tgApiHash:prev.tgApiHash|| creds.values.tg_api_hash  || '',
      tgPhone:  prev.tgPhone  || creds.values.tg_phone     || '',
      dc:       prev.dc       || creds.values.dc_bot_token || '',
      gemini:   prev.gemini   || creds.values.llm_gemini   || '',
      openai:   prev.openai   || creds.values.llm_openai   || '',
      claude:   prev.claude   || creds.values.llm_claude   || '',
    }));
  },[creds.loaded]);

  // Debounced credential persistence — saves token ~600ms after typing stops.
  const saveTimers = React.useRef({});
  const sv = (k, v) => {
    setFld(f=>({...f,[k]:v}));
    const credKey = ({
      tgToken:'tg_bot_token', tgApiId:'tg_api_id', tgApiHash:'tg_api_hash', tgPhone:'tg_phone',
      dc:'dc_bot_token', gemini:'llm_gemini', openai:'llm_openai', claude:'llm_claude'
    })[k];
    if (!credKey) return;
    if (saveTimers.current[k]) clearTimeout(saveTimers.current[k]);
    saveTimers.current[k] = setTimeout(()=>{ CRED_STORE.set(credKey, v); }, 600);
  };

  // ── LLM model catalog & current per-provider selection ────────
  // Fetched once from `get_llm_models`. The catalog lives server-side
  // so when models get deprecated and replaced we just edit api.php
  // and the dropdown updates without a frontend rebuild.
  const [llmModels, setLlmModels] = React.useState({
    catalog: { gemini: [], openai: [], claude: [] },
    selected: { gemini: '', openai: '', claude: '' },
    defaults: { gemini: '', openai: '', claude: '' },
  });
  const [llmModelSaving, setLlmModelSaving] = React.useState({});
  React.useEffect(() => {
    let cancelled = false;
    apiFetch('get_llm_models', {})
      .then(r => {
        if (cancelled || !r || r.error) return;
        setLlmModels({
          catalog:  r.catalog  || { gemini: [], openai: [], claude: [] },
          selected: r.selected || { gemini: '', openai: '', claude: '' },
          defaults: r.defaults || { gemini: '', openai: '', claude: '' },
        });
      })
      .catch(()=>{});
    return () => { cancelled = true; };
  }, []);
  // Persist a per-provider model choice. Optimistic — we update local
  // state immediately so the dropdown reflects the change, then PATCH
  // the server. On failure the dropdown reverts to the previous value.
  const saveLlmModel = (provider, modelId) => {
    const prev = llmModels.selected[provider] || '';
    setLlmModels(s => ({...s, selected: {...s.selected, [provider]: modelId}}));
    setLlmModelSaving(s => ({...s, [provider]: true}));
    apiFetch('set_llm_model', {provider, model: modelId})
      .then(r => {
        if (!r || r.error) {
          // revert
          setLlmModels(s => ({...s, selected: {...s.selected, [provider]: prev}}));
        }
      })
      .catch(() => {
        setLlmModels(s => ({...s, selected: {...s.selected, [provider]: prev}}));
      })
      .finally(() => {
        setLlmModelSaving(s => {
          const next = {...s}; delete next[provider]; return next;
        });
      });
  };

  const save = lbl => {
    setSaved(lbl); setTimeout(()=>setSaved(''),2200);
    // Shared status pill — same look as every other save in the app.
    bcToast(/connected$/i.test(String(lbl)) ? String(lbl) : String(lbl) + ' saved', 'ok');
  };
  const TABS = [{id:'platforms',label:'Platforms'},{id:'llm',label:'LLM Keys'},{id:'notify',label:'Notifications'},{id:'general',label:'General'}];

  // ── CONNECTION STATUS RE-CHECK ON MOUNT ─────────────────────────
  // CONN_STORE starts with connected:false and only updates when the .NET
  // host fires telegramStatus / discordStatus events. If Settings opens
  // (or the platform popup appears) after those events already fired and
  // were missed, CONN_STORE still shows "disconnected" even though the bot
  // is live. Fix: on mount request a fresh status ping from BotBridge so the
  // current real state is reflected immediately. Only fires if a token exists
  // and BotBridge is ready — safe no-op otherwise.
  React.useEffect(() => {
    if (!window.BotBridge) return;
    try {
      const tgTok = CRED_STORE.get('tg_bot_token');
      const dcTok = CRED_STORE.get('dc_bot_token');
      if (tgTok && !CONN_STORE.telegram.connected) {
        // BotBridge.getStatus fires a telegramStatus event with the real state
        if (typeof window.BotBridge.getStatus === 'function') {
          window.BotBridge.getStatus('telegram');
        } else if (typeof window.BotBridge.checkTelegramStatus === 'function') {
          window.BotBridge.checkTelegramStatus();
        }
      }
      if (dcTok && !CONN_STORE.discord.connected) {
        if (typeof window.BotBridge.getStatus === 'function') {
          window.BotBridge.getStatus('discord');
        } else if (typeof window.BotBridge.checkDiscordStatus === 'function') {
          window.BotBridge.checkDiscordStatus();
        }
      }
    } catch (_) {}
  }, []);  // run once on mount

  // Auto-reconnect back-off timers (per-platform). Cleared when a
  // connect attempt succeeds or the operator explicitly disconnects.
  const reconnectTimerRef = React.useRef({});

  // Local listener — handles busy-state, toast, and auto-reconnect.
  // CONN_STORE is updated by the global bcEvent handler at module scope.
  React.useEffect(()=>{
    // Auto-reconnect is opt-in via the "Auto-reconnect / auto-login" toggle.
    // Default ON — only '0' disables it. When on, a dropped connection is
    // retried LIVE and indefinitely (internet outages can last minutes), using
    // the saved credentials + persisted session so the User API re-logs in
    // without a fresh OTP.
    const autoReconnectOn = () => CRED_STORE.get('tg_auto_reconnect') !== '0';
    const attemptReconnect = (platform) => {
      // Reconnection is now owned by the always-on supervisor at the app root
      // (mounted for the whole session), so it works even when this Settings
      // popup is closed. We no longer schedule a duplicate retry here — doing
      // so would double-fire connect calls and flap the connection.
      return;
      // eslint-disable-next-line no-unreachable
      if (intentionalDisconnectRef.current) return;
      if (!autoReconnectOn()) {
        console.log('[auto-reconnect] disabled by setting — not retrying', platform);
        return;
      }
      if (!window.BotBridge) return;
      const isWV2local = window.BotBridge.isWebView2 && window.BotBridge.isWebView2();
      if (!isWV2local) return;
      // Stagger the back-off 4 s → 12 s → 30 s, then hold at 30 s and keep
      // retrying live until the link returns or the operator disconnects.
      // We no longer give up after 3 tries — a brief outage should never
      // leave the bot permanently offline.
      const tRef = reconnectTimerRef.current;
      const attempt = (tRef[platform + '_count'] || 0) + 1;
      tRef[platform + '_count'] = attempt;
      const delayMs = [4000, 12000, 30000][attempt - 1] || 30000;
      console.log('[auto-reconnect] scheduling attempt', attempt, 'in', delayMs, 'ms for', platform);
      if (tRef[platform]) clearTimeout(tRef[platform]);
      tRef[platform] = setTimeout(() => {
        if (intentionalDisconnectRef.current) return;
        if (platform === 'telegram') {
          const tok   = CRED_STORE.get('tg_bot_token') || '';
          const id    = CRED_STORE.get('tg_api_id')    || '';
          const hash  = CRED_STORE.get('tg_api_hash')  || '';
          const phone = CRED_STORE.get('tg_phone')     || '';
          if (tok) {
            console.log('[auto-reconnect] retrying Telegram bot token');
            setTgBusy(true);
            CONN_STORE.set('telegram', { error: '' });
            window.BotBridge.connectTelegram(tok);
          } else if (id && hash && phone) {
            console.log('[auto-reconnect] retrying Telegram user API');
            setTgBusy(true);
            CONN_STORE.set('telegram', { error: '' });
            window.BotBridge.connectTelegramUser(id, hash, phone);
          }
        } else if (platform === 'discord') {
          const tok = CRED_STORE.get('dc_bot_token') || '';
          if (tok) {
            console.log('[auto-reconnect] retrying Discord');
            setDcBusy(true);
            CONN_STORE.set('discord', { error: '' });
            window.BotBridge.connectDiscord(tok);
          }
        }
      }, delayMs);
    };

    const h = e => {
      const {event, data} = e.detail;
      if (event === 'telegramStatus') {
        setTgBusy(false);
        if (data && data.connected) {
          // Success — clear any pending reconnect attempts.
          const t = reconnectTimerRef.current;
          clearTimeout(t.telegram); delete t.telegram; delete t['telegram_count'];
          save('Telegram connected');
        } else if (data && data.reconnecting) {
          // The .NET host is already retrying this drop live (Bot API
          // supervised polling loop / User API supervision). Stand down so
          // our timer doesn't fight it, but keep the busy spinner honest.
          setTgBusy(false);
        } else if (data && !data.connected && !intentionalDisconnectRef.current) {
          // Unexpected disconnect the host isn't handling itself — schedule
          // the front-end auto-reconnect.
          attemptReconnect('telegram');
        }
      }
      if (event === 'discordStatus') {
        setDcBusy(false);
        if (data && data.connected) {
          const t = reconnectTimerRef.current;
          clearTimeout(t.discord); delete t.discord; delete t['discord_count'];
          save('Discord connected');
        } else if (data && !data.connected && !intentionalDisconnectRef.current) {
          attemptReconnect('discord');
        }
      }
      if (event === 'telegramError') { setTgBusy(false); }
      if (event === 'discordError')  { setDcBusy(false); }
      // Once .NET asks for OTP/2FA the connection attempt is in progress —
      // drop the "Authorising…" spinner so the OTP modal owns the UI.
      if (event === 'telegramAuthRequired') { setTgBusy(false); }
    };
    window.addEventListener('bcEvent', h);
    return () => {
      window.removeEventListener('bcEvent', h);
      // Clear reconnect timers on unmount so they don't fire into the void.
      const t = reconnectTimerRef.current;
      clearTimeout(t.telegram); clearTimeout(t.discord);
    };
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Watchdog — if .NET never replies within 14s, unstick the busy flag
  // and surface a clear error. Skips if operator intentionally disconnected
  // (they set busy=false themselves, so this guard is belt-and-braces).
  React.useEffect(()=>{
    if (!tgBusy) return;
    const t = setTimeout(()=>{
      if (intentionalDisconnectRef.current) return;
      setTgBusy(false);
      CONN_STORE.set('telegram', { error: 'Timed out — no response from .NET host.' });
    }, 14000);
    return ()=>clearTimeout(t);
  },[tgBusy]);
  React.useEffect(()=>{
    if (!dcBusy) return;
    const t = setTimeout(()=>{
      setDcBusy(false);
      CONN_STORE.set('discord', { error: 'Timed out — no response from .NET host.' });
    }, 14000);
    return ()=>clearTimeout(t);
  },[dcBusy]);

  const bridge = window.BotBridge;
  const isWV2  = bridge && bridge.isWebView2 && bridge.isWebView2();

  // intentionalDisconnectRef prevents the auto-reconnect from firing when
  // the operator explicitly clicked Disconnect.
  const intentionalDisconnectRef = React.useRef(false);

  const connectTg = () => {
    const tok = (fld.tgToken || '').trim();
    if (!tok || tgBusy) return;
    CONN_SUPPRESS.telegram = false;
    setTgBusy(true);
    CONN_STORE.set('telegram', { error: '' });
    window.BotBridge.connectTelegram(tok);
  };
  const connectTgUser = () => {
    const id   = (fld.tgApiId   || '').trim();
    const hash = (fld.tgApiHash || '').trim();
    const phone= (fld.tgPhone   || '').trim();
    if (!id || !hash || !phone || tgBusy) return;
    CONN_SUPPRESS.telegram = false;
    setTgBusy(true);
    CONN_STORE.set('telegram', { error: '' });
    window.BotBridge.connectTelegramUser(id, hash, phone);
  };
  const disconnectTg = () => {
    intentionalDisconnectRef.current = true;
    CONN_SUPPRESS.telegram = true;
    setTgBusy(false);
    window.BotBridge.disconnectTelegram();
    CONN_STORE.set('telegram', { connected:false, botName:'', username:'', botId:'', avatar:'', error:'' });
    // Reset flag after a tick so the telegramStatus event from .NET
    // (which fires synchronously on some hosts) is already handled.
    setTimeout(() => { intentionalDisconnectRef.current = false; }, 500);
  };
  const connectDc = () => {
    const tok = (fld.dc || '').trim();
    if (!tok || dcBusy) return;
    CONN_SUPPRESS.discord = false;
    setDcBusy(true);
    CONN_STORE.set('discord', { error: '' });
    window.BotBridge.connectDiscord(tok);
  };
  const disconnectDc = () => {
    CONN_SUPPRESS.discord = true;
    setDcBusy(false);
    window.BotBridge.disconnectDiscord();
    CONN_STORE.set('discord', { connected:false, botName:'', username:'', botId:'', avatar:'', error:'' });
  };

  // LLM key save — pushes immediately to DB (sv already debounces during typing,
  // but the explicit Save button forces the persistence and shows feedback).
  const saveLlmKey = (which, label) => {
    const credKey = ({gemini:'llm_gemini', openai:'llm_openai', claude:'llm_claude'})[which];
    if (!credKey) return;
    CRED_STORE.set(credKey, fld[which]);
    save(label);
  };

  // Left panel content per tab
  const leftContent = {
    platforms: (
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {[{id:'telegram',icon:<TgIcon s={13}/>,label:'Telegram',connected:tgConn.connected},
          {id:'discord',icon:<DcIcon s={13}/>,label:'Discord',connected:dcConn.connected}].map(p=>(
          <button key={p.id} onClick={()=>setPlatSel(p.id)}
            style={{padding:'10px 11px',display:'flex',alignItems:'center',gap:10,
              background:platSel===p.id?'rgba(108,99,255,0.12)':'rgba(255,255,255,0.025)',
              border:`1px solid ${platSel===p.id?'rgba(108,99,255,0.4)':'rgba(255,255,255,0.06)'}`,
              borderRadius:9,cursor:'pointer',transition:'all 0.12s',textAlign:'left',
              color:platSel===p.id?'var(--t1)':'var(--t2)',fontSize:12.5,fontWeight:platSel===p.id?600:400}}>
            {p.icon}<span>{p.label}</span>
            {p.connected && <Pip col="var(--ok)" sz={5} pulse/>}
            {platSel===p.id&&<svg style={{marginLeft:'auto'}} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--acc)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"/></svg>}
          </button>
        ))}
      </div>
    ),
    llm: (
      <div style={{display:'flex',flexDirection:'column',gap:6}}>
        {LLM_PROVIDERS.map(p=>{
          const has = !!(fld[p.id] || (creds.values || {})[`llm_${p.id}`]);
          const isActive = ((creds.values||{}).llm_active || '') === p.id;
          return (
            <div key={p.id} style={{padding:'9px 11px',display:'flex',alignItems:'center',gap:10,background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:9,color:'var(--t2)',fontSize:12.5,fontWeight:500}}>
              <p.Icon s={15}/>
              <span style={{flex:1,minWidth:0,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',color:has?'var(--t1)':'var(--t3)'}}>{p.full}</span>
              {isActive && <Pip col="var(--acc)" sz={5} pulse/>}
              {has && !isActive && <Pip col="var(--ok)" sz={5}/>}
            </div>
          );
        })}
      </div>
    ),
    notify: <div style={{padding:'10px 11px',background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:9,color:'var(--t3)',fontSize:11.5,lineHeight:1.6}}>Configure which events trigger alerts. Toggle each one independently.</div>,
    general: <div style={{padding:'10px 11px',background:'rgba(255,255,255,0.025)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:9,color:'var(--t3)',fontSize:11.5,lineHeight:1.6}}>Global defaults applied across all agents and conversations.</div>,
  };

  const [pingMsg, setPingMsg] = React.useState('');
  const sendPing = () => {
    if(!window.BotBridge || !window.BotBridge.isWebView2()) {
      setPingMsg('⚠ Not running in WebView2 — bridge inactive');
      setTimeout(()=>setPingMsg(''),3000);
      return;
    }
    window.BotBridge.ping();
    setPingMsg('⏳ Ping sent — waiting for .NET…');
  };
  // Listen for pong
  React.useEffect(()=>{
    const h = e => {
      if(e.detail.event==='pong') {
        setPingMsg('✓ .NET is alive · ' + (e.detail.data?.msg||'Connected'));
        setTimeout(()=>setPingMsg(''),4000);
      }
    };
    window.addEventListener('bcEvent',h);
    return ()=>window.removeEventListener('bcEvent',h);
  },[]);

  const tgProfileMeta = creds.meta && creds.meta.tg_bot_profile;
  const dcProfileMeta = creds.meta && creds.meta.dc_bot_profile;

  return (
    <div style={{padding: _embedTab ? '4px 12px 16px' : '24px 20px 32px', height: _embedTab ? 'auto' : '100%', overflow: _embedTab ? 'visible' : 'auto', background:'transparent'}}>
      <div style={{maxWidth: _embedTab ? '100%' : 1100, margin:'0 auto', display:'flex', flexDirection:'column', gap: _embedTab ? 10 : 18}}>

        {/* .NET / WebView2 status bar — hidden in embed mode; the
            sub-popup header DiagPill carries this information instead. */}
        {!_embedTab && (
        <div style={{display:'flex',alignItems:'center',gap:10,padding:'9px 14px',borderRadius:9,
          background: isWV2 ? 'rgba(48,209,88,0.06)' : 'rgba(255,159,10,0.06)',
          border: `1px solid ${isWV2 ? 'rgba(48,209,88,0.2)' : 'rgba(255,159,10,0.25)'}`,
        }}>
          <Pip col={isWV2?'var(--ok)':'var(--warn)'} sz={7} pulse={!isWV2}/>
          <span style={{fontSize:11.5,fontWeight:500,color:isWV2?'var(--ok)':'var(--warn)',flex:1}}>
            {isWV2 ? '.NET host detected — bridge active' : 'Running in browser — WebView2 bridge inactive (controls disabled)'}
          </span>
          {isWV2 && (
            <button onClick={sendPing}
              style={{padding:'5px 12px',fontSize:11,fontWeight:600,borderRadius:6,cursor:'pointer',
                background:'rgba(48,209,88,0.12)',color:'var(--ok)',border:'1px solid rgba(48,209,88,0.28)',
                transition:'all 0.12s'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(48,209,88,0.2)'}
              onMouseLeave={e=>e.currentTarget.style.background='rgba(48,209,88,0.12)'}
            >Ping .NET</button>
          )}
          {pingMsg && <span style={{fontSize:11,color:pingMsg.startsWith('✓')?'var(--ok)':pingMsg.startsWith('⚠')?'var(--warn)':'var(--t2)',fontFamily:'var(--mono)'}}>{pingMsg}</span>}
        </div>
        )}

        {/* Tab bar — hidden in embed mode (sheet provides its own back-nav). */}
        {!_embedTab && (
        <div style={{display:'flex',alignItems:'center',gap:0,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>
          {TABS.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:'10px 16px',fontSize:12,fontWeight:600,letterSpacing:'-0.01em',background:'transparent',border:'none',cursor:'pointer',
                color:tab===t.id?'var(--t1)':'var(--t3)',
                borderBottom:tab===t.id?'2px solid var(--acc)':'2px solid transparent',
                marginBottom:-1,transition:'color 0.12s'}}>{t.label}
            </button>
          ))}
        </div>
        )}

        {/* Two-column layout — collapses to single column inside the sheet. */}
        <div style={{display:'grid',gridTemplateColumns: _embedTab ? '1fr' : '220px 1fr',gap: _embedTab ? 12 : 18, minHeight: _embedTab ? 0 : 520}}>

          {/* Left — only show when not embedded (root menu replaces it). */}
          {!_embedTab && (
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {leftContent[tab]}
          </div>
          )}

          {/* Right panel — in embed mode the popup itself is the card,
              so we drop the inner glass background to avoid nested chrome. */}
          <div style={_embedTab ? {padding:'2px 0'} : {background:'rgba(20,22,42,0.82)',backdropFilter:'blur(20px) saturate(160%)',WebkitBackdropFilter:'blur(20px) saturate(160%)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:13, padding:'22px 24px', minHeight:520, boxShadow:'0 4px 32px rgba(0,0,0,0.32), 0 1px 0 rgba(255,255,255,0.05) inset'}}>

            {/* Embed-mode: full mode keeps the left rail, embedded mode
                stacks both platforms vertically — no second segmented. */}
            {_embedTab==='platforms' && false && (
              <div style={{display:'flex',justifyContent:'center',marginBottom:14}}>
                <SsetSeg value={platSel} onChange={setPlatSel} options={[
                  {id:'telegram',label:'Telegram'},
                  {id:'discord',label:'Discord'},
                ]}/>
              </div>
            )}

            {/* ── PLATFORMS (full-mode legacy connected-accounts header) ── */}
            {tab==='platforms' && !_embedTab && (tgConn.connected || dcConn.connected || tgProfileMeta || dcProfileMeta) && (
              <div style={{marginBottom:20}}>
                <SectionDivider label="Connected Accounts"/>
                <div style={{display:'flex',flexDirection:'column',gap:8,marginTop:10}}>
                  {(tgConn.connected || tgProfileMeta) && (
                    <ConnectedAccountCard platform="telegram" conn={tgConn}
                      profileMeta={tgProfileMeta}
                      onDisconnect={disconnectTg} isWV2={isWV2}/>
                  )}
                  {(dcConn.connected || dcProfileMeta) && (
                    <ConnectedAccountCard platform="discord" conn={dcConn}
                      profileMeta={dcProfileMeta}
                      onDisconnect={disconnectDc} isWV2={isWV2}/>
                  )}
                </div>
              </div>
            )}

            {/* ── PLATFORMS — embed mode: stacked, both platforms visible. ── */}
            {tab==='platforms' && _embedTab && (
              <div style={{display:'flex',flexDirection:'column',gap:14}}>

                {/* Telegram block */}
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7}}>
                    <TgIcon s={13}/>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.005em'}}>Telegram</span>
                    {tgConn.connected && <Pip col="var(--ok)" sz={6} pulse/>}
                    <span style={{flex:1}}/>
                    {/* compact mode toggle — just text links, no boxed pill */}
                    <div style={{display:'flex',gap:2,padding:2,background:'rgba(255,255,255,0.04)',borderRadius:6}}>
                      {[{id:'bot',label:'Bot'},{id:'user',label:'User'}].map(m=>(
                        <button key={m.id} onClick={()=>setTgMode(m.id)}
                          style={{padding:'2px 8px',border:'none',cursor:'pointer',borderRadius:4,
                            fontSize:10,fontWeight:tgMode===m.id?600:500,letterSpacing:'-0.005em',
                            background:tgMode===m.id?'var(--s1)':'transparent',
                            color:tgMode===m.id?'var(--t1)':'var(--t3)',
                            boxShadow:tgMode===m.id?'0 1px 3px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.06)':'none',
                            transition:'all 0.12s'}}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {(tgConn.connected || tgProfileMeta) && (
                    <ConnectedChip platform="telegram" conn={tgConn}
                      profileMeta={tgProfileMeta}
                      onDisconnect={disconnectTg} isWV2={isWV2}/>
                  )}

                  {tgMode==='bot' && (
                    <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
                      <FInput label="Token" type="password" value={fld.tgToken}
                        onChange={v=>sv('tgToken',v)} placeholder="1234567890:ABCdef…"
                        info={<>Bot token from <strong>@BotFather</strong>. Persists across launches.</>}/>
                      <button className="sset-pri" data-variant={tgConn.connected?'danger':undefined}
                        onClick={tgConn.connected?disconnectTg:connectTg}
                        disabled={!isWV2||(!tgConn.connected&&(!fld.tgToken||tgBusy))}
                        title={!isWV2?'Requires WebView2 host':undefined}>
                        {tgBusy?'…':tgConn.connected?'Disconnect':'Connect'}
                      </button>
                    </div>
                  )}
                  {tgMode==='user' && (
                    <div style={{display:'flex',flexDirection:'column',gap:8}}>
                      <div style={{display:'flex',gap:8}}>
                        <FInput label="API ID" value={fld.tgApiId} onChange={v=>sv('tgApiId',v)} placeholder="12345678"/>
                        <FInput label="API Hash" type="password" value={fld.tgApiHash} onChange={v=>sv('tgApiHash',v)} placeholder="abc123…"/>
                      </div>
                      <FInput label="Phone" value={fld.tgPhone} onChange={v=>sv('tgPhone',v)} placeholder="+1 650 555 0100"
                        info={<><strong>User API (MTProto)</strong> — controls a real account. OTP is sent on sign-in; 2FA users also enter the cloud password.</>}/>
                      <button className="sset-pri" data-variant={tgConn.connected?'danger':undefined}
                        onClick={tgConn.connected?disconnectTg:connectTgUser}
                        disabled={!isWV2||(!tgConn.connected&&(!(fld.tgApiId||'').trim()||!(fld.tgApiHash||'').trim()||!(fld.tgPhone||'').trim()||tgBusy))}
                        title={!isWV2?'Requires WebView2 host':undefined}>
                        {tgBusy?'Authorising…':tgConn.connected?'Disconnect':'Sign in'}
                      </button>
                    </div>
                  )}
                  {/* Auto-connect — keeps Telegram connected automatically on
                      app start, after login, and if the connection drops. */}
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'8px 2px'}}>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:600,color:'var(--t1)'}}>Auto-connect</div>
                      <div style={{fontSize:11,color:'#8a8aa8',lineHeight:1.4}}>Reconnects on app start, after login, and if the internet drops. User API signs back in from its saved session.</div>
                    </div>
                    <SsetTgl checked={(creds.values||{}).tg_auto_reconnect !== '0'}
                      onChange={on=>CRED_STORE.set('tg_auto_reconnect', on?'1':'0')}/>
                  </div>
                  {tgConn.error&&<SErr msg={tgConn.error}/>}
                </div>

                <div style={{height:1,background:'rgba(255,255,255,0.06)'}}/>

                {/* Discord block */}
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7}}>
                    <DcIcon s={13}/>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--t1)',letterSpacing:'-0.005em'}}>Discord</span>
                    {dcConn.connected && <Pip col="var(--ok)" sz={6} pulse/>}
                  </div>

                  {(dcConn.connected || dcProfileMeta) && (
                    <ConnectedChip platform="discord" conn={dcConn}
                      profileMeta={dcProfileMeta}
                      onDisconnect={disconnectDc} isWV2={isWV2}/>
                  )}

                  <div style={{display:'flex',gap:8,alignItems:'stretch'}}>
                    <FInput label="Token" type="password" value={fld.dc}
                      onChange={v=>sv('dc',v)} placeholder="MTxxxx.Gxxxxx…"
                      info={<>From <strong>discord.com/developers</strong>. Enable <strong>Message Content Intent</strong> or messages arrive empty.</>}/>
                    <button className="sset-pri" data-variant={dcConn.connected?'danger':undefined}
                      onClick={dcConn.connected?disconnectDc:connectDc}
                      disabled={!isWV2||(!dcConn.connected&&(!fld.dc||dcBusy))}
                      title={!isWV2?'Requires WebView2 host':undefined}>
                      {dcBusy?'…':dcConn.connected?'Disconnect':'Connect'}
                    </button>
                  </div>
                  {dcConn.error&&<SErr msg={dcConn.error}/>}
                </div>

              </div>
            )}

            {/* ── PLATFORMS — full mode (legacy two-column) ── */}
            {tab==='platforms' && !_embedTab && platSel==='telegram' && (
              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                <SectionDivider label="Telegram"/>

                {/* mode toggle */}
                <div style={{display:'flex',gap:0,padding:3,background:'var(--s3)',border:'1px solid var(--ln2)',borderRadius:8,width:'fit-content'}}>
                  {[{id:'bot',label:'Bot API',sub:'@BotFather'},{id:'user',label:'User API',sub:'MTProto'}].map(m=>(
                    <button key={m.id} onClick={()=>setTgMode(m.id)}
                      style={{padding:'6px 14px',border:'none',cursor:'pointer',transition:'all 0.13s',borderRadius:6,
                        background:tgMode===m.id?'var(--s1)':'transparent',
                        boxShadow:tgMode===m.id?'0 1px 4px rgba(0,0,0,0.4),0 0 0 1px rgba(255,255,255,0.07)':'none'}}>
                      <div style={{fontSize:12,fontWeight:tgMode===m.id?600:400,color:tgMode===m.id?'var(--t1)':'var(--t3)',lineHeight:1.2}}>{m.label}</div>
                      <div style={{fontSize:9.5,color:tgMode===m.id?'var(--t3)':'var(--t4)',fontFamily:'var(--mono)',letterSpacing:'0.03em'}}>{m.sub}</div>
                    </button>
                  ))}
                </div>

                {tgMode==='bot' && (
                  <div style={{display:'flex',flexDirection:'column',gap:14}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'flex-end'}}>
                      <SField label="Bot Token">
                        <input className="fi" type="password" value={fld.tgToken} onChange={e=>sv('tgToken',e.target.value)} placeholder="1234567890:ABCdef…"/>
                      </SField>
                      <button className="abtn nw" onClick={tgConn.connected?disconnectTg:connectTg} style={{alignSelf:'flex-end',background:tgConn.connected?'rgba(255,69,58,0.15)':'var(--acc)',color:tgConn.connected?'var(--err)':'#fff',border:tgConn.connected?'1px solid rgba(255,69,58,0.3)':'none',minWidth:90,display:'flex',alignItems:'center',justifyContent:'center',gap:5}} disabled={!isWV2||(!tgConn.connected&&(!fld.tgToken||tgBusy))} title={!isWV2?'Requires WebView2 host':undefined}>{tgBusy?'Connecting…':tgConn.connected?'Disconnect':'Connect'}</button>
                    </div>
                    {tgConn.connected&&<SOk label={`Connected · ${tgConn.botName||'bot'} ${tgConn.username?'('+tgConn.username+')':''}`}/>}
                    {tgConn.error&&<SErr msg={tgConn.error}/>}
                    <SNote><strong style={{color:'var(--t2)'}}>Bot API</strong> — controls a dedicated bot account created via @BotFather. Users must initiate contact first. Best for public-facing automations. Token is saved to your database and auto-loaded on startup.</SNote>
                  </div>
                )}
                {tgMode==='user' && (
                  <div style={{display:'flex',flexDirection:'column',gap:14}}>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}>
                      <SField label="API ID"><input className="fi" value={fld.tgApiId} onChange={e=>sv('tgApiId',e.target.value)} placeholder="12345678"/></SField>
                      <SField label="API Hash"><input className="fi" type="password" value={fld.tgApiHash} onChange={e=>sv('tgApiHash',e.target.value)} placeholder="abc123def456…"/></SField>
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'flex-end'}}>
                      <SField label="Phone Number"><input className="fi" value={fld.tgPhone} onChange={e=>sv('tgPhone',e.target.value)} placeholder="+1 650 555 0100"/></SField>
                      <button className="abtn nw" onClick={tgConn.connected?disconnectTg:connectTgUser} style={{alignSelf:'flex-end',background:tgConn.connected?'rgba(255,69,58,0.15)':'var(--acc)',color:tgConn.connected?'var(--err)':'#fff',border:tgConn.connected?'1px solid rgba(255,69,58,0.3)':'none',minWidth:90,display:'flex',alignItems:'center',justifyContent:'center',gap:5}} disabled={!isWV2||(!tgConn.connected&&(!fld.tgApiId||!fld.tgApiHash||!fld.tgPhone||tgBusy))} title={!isWV2?'Requires WebView2 host':undefined}>{tgBusy?'Authorising…':tgConn.connected?'Disconnect':'Authorise'}</button>
                    </div>
                    <SField label="Session String"><input className="fi" type="password" placeholder="Optional — paste Pyrogram/Telethon session to skip OTP"/></SField>
                    {tgConn.connected&&<SOk label="Authorised · User session active"/>}
                    {tgConn.error&&<SErr msg={tgConn.error}/>}
                    <SNote warn><strong style={{color:'rgba(255,200,80,0.9)'}}>User API (MTProto)</strong> — controls a real Telegram user account via the client protocol. Authorising will send an OTP to your Telegram app; if you have 2FA enabled you'll also be asked for your cloud password. Sessions are saved per phone number and reused on next launch.</SNote>
                  </div>
                )}
              </div>
            )}

            {tab==='platforms' && !_embedTab && platSel==='discord' && (
              <div style={{display:'flex',flexDirection:'column',gap:16}}>
                <SectionDivider label="Discord"/>
                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                  <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:10,alignItems:'flex-end'}}>
                    <SField label="Bot Token"><input className="fi" type="password" value={fld.dc} onChange={e=>sv('dc',e.target.value)} placeholder="MTxxxx.Gxxxxx…"/></SField>
                    <button className="abtn nw" onClick={dcConn.connected?disconnectDc:connectDc} style={{alignSelf:'flex-end',background:dcConn.connected?'rgba(255,69,58,0.10)':undefined,color:dcConn.connected?'rgba(255,120,110,0.95)':undefined,border:dcConn.connected?'1px solid rgba(255,69,58,0.28)':undefined,minWidth:90}} disabled={!isWV2||(!dcConn.connected&&(!fld.dc||dcBusy))} title={!isWV2?'Requires WebView2 host':undefined}>{dcBusy?'Connecting…':dcConn.connected?'Disconnect':'Connect'}</button>
                  </div>
                  {dcConn.connected&&<SOk label={`Connected · ${dcConn.botName||'Bot active'}`}/>}
                  {dcConn.error&&<SErr msg={dcConn.error}/>}
                  <SNote><strong style={{color:'var(--t2)'}}>Discord Bot</strong> — create a bot at discord.com/developers, invite it to your server, and paste the token above. <strong>Enable the "Message Content Intent"</strong> in the bot settings on the developer portal, otherwise message contents will arrive empty. Token is saved to your database and auto-loaded on startup.</SNote>
                </div>
              </div>
            )}

            {/* ── LLM KEYS ── */}
            {tab==='llm' && (
              <div style={{display:'flex',flexDirection:'column',gap:_embedTab?12:22}}>
                {_embedTab
                  ? <div className="sset-hairline"><span className="sset-hairline-label">Active provider</span><span className="sset-hairline-rule"/></div>
                  : <SectionDivider label="Active Provider"/>}
                <ActiveLlmPicker creds={creds} fld={fld}/>
                {_embedTab
                  ? <div className="sset-hairline"><span className="sset-hairline-label">API keys</span><span className="sset-hairline-rule"/></div>
                  : <SectionDivider label="AI Providers"/>}
                {LLM_PROVIDERS.map((p)=>{
                  const k = p.id;
                  const t = p.full;
                  const hint = p.hint;
                  const badge = p.id === 'gemini' ? 'Recommended' : null;
                  const catalog = (llmModels.catalog && llmModels.catalog[k]) || [];
                  const selectedModel = (llmModels.selected && llmModels.selected[k]) || '';
                  const defaultModel  = (llmModels.defaults && llmModels.defaults[k]) || '';
                  // Effective value the dropdown shows — selected, else default,
                  // else first in catalog. Keeps the picker non-empty even on
                  // a brand-new account that's never saved a model choice.
                  const effective = selectedModel || defaultModel || (catalog[0] && catalog[0].id) || '';
                  return (
                  <div key={k}>
                    <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:_embedTab?7:10}}>
                      <p.Icon s={_embedTab?13:15}/>
                      <span style={{fontSize:_embedTab?12:13,fontWeight:600,color:'var(--t1)'}}>{t}</span>
                      {badge&&<span style={{fontSize:8.5,fontWeight:700,color:'rgba(120,200,150,0.85)',background:'rgba(48,209,88,0.06)',border:'1px solid rgba(48,209,88,0.18)',padding:'1.5px 6px',borderRadius:4,letterSpacing:'0.04em'}}>{badge}</span>}
                    </div>
                    <div style={{display:'grid',gridTemplateColumns:'1fr auto',gap:8,alignItems:'flex-end'}}>
                      <SField label="API Key"><input className="fi" type="password" value={fld[k]} onChange={e=>sv(k,e.target.value)} placeholder="Enter key…"/></SField>
                      <button className="abtn nw" onClick={()=>saveLlmKey(k,t)} style={{alignSelf:'flex-end'}}>Save</button>
                    </div>
                    {/* Model picker — sits beneath the API key. Reads the
                        catalog from the server (get_llm_models) and saves
                        on change via set_llm_model. The "default" hint
                        shows next to the active selection so users know
                        which one is the recommended starting point. */}
                    {catalog.length > 0 && (
                      <div style={{marginTop:8}}>
                        <SField label={
                          <span style={{display:'flex',alignItems:'center',gap:6}}>
                            <span>Model</span>
                            {llmModelSaving[k] && <span style={{fontSize:9,color:'var(--t4)',fontStyle:'italic'}}>saving…</span>}
                            {!llmModelSaving[k] && selectedModel && selectedModel !== defaultModel &&
                              <span style={{fontSize:8.5,fontWeight:700,color:'rgba(160,180,220,0.75)',letterSpacing:'0.06em'}}>CUSTOM</span>}
                          </span>
                        }>
                          <select
                            className="fi"
                            value={effective}
                            onChange={e=>saveLlmModel(k, e.target.value)}
                          >
                            {catalog.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.label}{m.id === defaultModel ? ' — default' : ''}{m.note ? ` · ${m.note}` : ''}
                              </option>
                            ))}
                          </select>
                        </SField>
                      </div>
                    )}
                    <div style={{fontSize:10.5,color:'var(--t3)',marginTop:5}}>{hint}</div>
                    {fld[k]&&<div style={{marginTop:6}}><span className="wd-saved">Saved</span></div>}
                  </div>
                  );
                })}
              </div>
            )}

            {/* ── NOTIFICATIONS ── */}
            {tab==='notify' && (
              <div>
                <SectionDivider label="Event Alerts"/>
                <div style={{marginTop:10}}>
                  {[
                    ['New conversation',true,'A new user opens a conversation'],
                    ['AI reply sent',false,'Every time an agent sends an automated reply'],
                    ['Needs human',true,'Agent flagged a conversation for manual review'],
                    ['AI error',true,'Agent encountered an unrecoverable error'],
                    ['Conversion',true,'Contact moved to purchasing or customer stage'],
                    ['Daily summary',false,'End-of-day digest with stats and highlights'],
                    ['Weekly digest',true,'Weekly rollup — delivered Monday morning'],
                  ].map(([l,d,hint],i,arr)=>(
                    <div key={l} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,padding:'11px 0',borderBottom:i<arr.length-1?'1px solid var(--ln)':'none'}}>
                      <div>
                        <div style={{fontSize:12.5,color:'var(--t1)',fontWeight:400}}>{l}</div>
                        <div style={{fontSize:11,color:'var(--t3)',marginTop:2}}>{hint}</div>
                      </div>
                      <label className="tgl"><input type="checkbox" defaultChecked={d}/><span className="tsl"/></label>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── GENERAL ── */}
            {tab==='general' && (
              <div style={{display:'flex',flexDirection:'column',gap:22}}>
                <SectionDivider label="Workspace"/>
                <div style={{display:'flex',flexDirection:'column',gap:13}}>
                  {[{l:'Business Name',type:'text',ph:'Your Company'},{l:'Language',type:'sel',opts:['English','Spanish','French','German','Portuguese']},{l:'AI Reply Delay',type:'sel',opts:['Instant','1–3 sec','3–8 sec','8–15 sec']},{l:'Auto-escalate',type:'sel',opts:['Never','3 failures','5 failures','On request']}].map(({l,type,ph,opts})=>(
                    <div key={l} style={{display:'flex',flexDirection:'column',gap:6}}>
                      <label style={{fontSize:9.5,fontWeight:700,color:'var(--t3)',textTransform:'uppercase',letterSpacing:'0.08em'}}>{l}</label>
                      {type==='text'?<input className="fi" placeholder={ph}/>:<select className="fi">{opts.map(o=><option key={o}>{o}</option>)}</select>}
                    </div>
                  ))}
                </div>
                <div>
                  <button className="abtn" onClick={()=>save('General')}>Save Changes</button>
                  {saved&&<span className="wd-saved" style={{marginLeft:10}}>Saved</span>}
                </div>
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};

// ── SIDEBAR ICONS ────────────────────────────────────────────
const SbIco = ({d, size=15}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    style={{flexShrink:0, opacity:0.7}}>
    <path d={d}/>
  </svg>
);
const ICONS = {
  dashboard: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  messages:  "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z",
  agents:    "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  products:  "M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
  payments:  "M2 7a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zM2 10h20M16 15h2",
  settings:  "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
};

// ── SIDEBAR ───────────────────────────────────────────────────
const unreadTotal = 0; // computed live in App via useMsgs()

const Sidebar = ({view, setView}) => (
  <div className="sb">
    {/* Brand */}
    <div className="sb-brand">
      <div className="sb-mark">BC</div>
      <div>
        <div className="sb-name">BotCommand</div>
        <div style={{fontSize:10, color:'var(--t3)', marginTop:1}}>Workspace</div>
      </div>
    </div>

    {/* Nav */}
    <nav className="sb-nav">
      <div className="sb-sect">Overview</div>
      {[
        {id:'messages',  label:'Messages',  ico:'messages', badge:unreadTotal},
      ].map(n=>(
        <button key={n.id} className={`sb-item${view===n.id?' sb-on':''}`} onClick={()=>setView(n.id)}>
          <div style={{display:'flex', alignItems:'center', gap:9}}>
            <SbIco d={ICONS[n.ico]}/>
            <span>{n.label}</span>
          </div>
          {n.badge>0&&<span className="sb-badge">{n.badge}</span>}
        </button>
      ))}

      <div className="sb-sect" style={{marginTop:6}}>Automation</div>
      {[
        {id:'agents',   label:'Agents',   ico:'agents'},
        {id:'products', label:'Products', ico:'products'},
        {id:'payments', label:'Payments', ico:'payments'},
      ].map(n=>(
        <button key={n.id} className={`sb-item${view===n.id?' sb-on':''}`} onClick={()=>setView(n.id)}>
          <div style={{display:'flex', alignItems:'center', gap:9}}>
            <SbIco d={ICONS[n.ico]}/>
            <span>{n.label}</span>
          </div>
        </button>
      ))}

      <div className="sb-divider"/>

      <button className={`sb-item${view==='settings'?' sb-on':''}`} onClick={()=>setView('settings')}>
        <div style={{display:'flex', alignItems:'center', gap:9}}>
          <SbIco d={ICONS.settings}/>
          <span>Settings</span>
        </div>
      </button>
    </nav>
  </div>
);

// ── SETTINGS ENTRY + SECTION SWITCHER ─────────────────────────
// Settings no longer takes a footer bar in the contact column. There is one
// quiet gear at the left end of the search field (and at the top of the
// collapsed avatar rail, where the search field would be). It opens the
// section that was open last.
//
// The window itself carries the navigation: a slim column of small circles
// docked to its left edge, one per section, in a fixed order. Clicking a
// circle swaps the window's body in place (same frame, same position — see
// ssetSnapshotPopup), and a single indicator slides to the new circle, so
// cycling through sections is one click each with nothing re-laid-out.
// Arrow Up / Down cycle while a circle has focus.
const SET_ICON_PATHS = {
  platforms: <><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></>,
  llm:       <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/>,
  agents:    <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
  catalog:   <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12"/></>,
  licenses:  <><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M15 8l2 2"/></>,
  payments:  <><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="16" y1="15" x2="18" y2="15"/></>,
  connections: <><path d="M9 2v5"/><path d="M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0V7z"/><path d="M12 17v5"/></>,
  billing:   <><rect x="2" y="5" width="20" height="14" rx="2.5"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></>,
  store:     <><path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 0 1-8 0"/></>,
  preferences: <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
};
const SET_GEAR_PATH = <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></>;
const SET_CHATS_PATH = <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>;
const SetIcon = ({children, size = 15}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>
);
// Four sections instead of seven. Things that are set up together now live
// together:
//   Connections — Accounts, LLM, Filters
//   Agents      — agent configuration
//   Catalog     — products, packages and add-ons
//   Licenses & payments — licenses, invoices, wallets and the license API
//   Preferences — Appearance, Notifications, General
// A section with more than one page shows those pages as a slim row of
// text tabs along the window's top edge; a page's own sub-tabs (e.g. Packages / Products / Add-ons) sit
// below as the smaller pill strip, so the two levels never look alike.
const SETTINGS_SECTIONS = [
  { id:'connections', label:'Connections', pages:[
    { id:'apps',    label:'Connections', sub:'Messaging apps, AI and privacy' },
  ]},
  { id:'agents', label:'Agents', pages:[
    { id:'agents',  label:'Agents',   sub:'Agent configuration' },
  ]},
  { id:'catalog', label:'Catalog', pages:[
    { id:'catalog',  label:'Catalog',  sub:'Products, packages and add-ons' },
  ]},
  { id:'licenses', label:'Licenses', pages:[
    { id:'licenses', label:'Licenses', sub:'Customer licenses and the license API' },
  ]},
  // Id kept as 'billing' so a saved "last section" still opens it.
  { id:'billing', label:'Payments', pages:[
    { id:'billing',  label:'Payments', sub:'Invoices and wallets' },
  ]},
  { id:'preferences', label:'Preferences', group:2, pages:[
    { id:'appearance',    label:'Appearance',    sub:'Theme, accent and layout' },
    { id:'notifications', label:'Notifications', sub:'Sounds and alerts' },
  ]},
];
const SSET_SECTION = SETTINGS_SECTIONS.reduce((m, sec) => { m[sec.id] = sec; return m; }, {});
// Older builds (and any caller still using the old ids) opened one of
// seven separate windows. Each old id now points at its section + page.
const SSET_LEGACY = {
  platforms: ['connections', 'apps'],
  llm:       ['connections', 'apps'],
  filters:   ['connections', 'apps'],
  store:     ['catalog', 'catalog'],
  licenses:  ['licenses', 'licenses'],
  payments:  ['billing', 'billing'],
  invoices:  ['billing', 'billing'],
  wallets:   ['billing', 'billing'],
};
// Old ids that should also land on a particular tab of Payments.
const SSET_BILLING_TAB = { payments:'all', invoices:'all', wallets:'wallets' };
// Tab requests for BillingView (bot-app.jsx): set before the window opens,
// taken once by the view when it mounts or while it is showing.
const BILLING_NAV = {
  req: null, subs: new Set(),
  go(tab) { this.req = tab; this.subs.forEach(f => { try { f(); } catch (_) {} }); },
  take() { const r = this.req; this.req = null; return r; },
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
};
const SSET_PAGE_KEY = 'bc.settings.page.';
const readLastPage = (secId) => {
  const sec = SSET_SECTION[secId];
  if (!sec) return null;
  try {
    const v = window.localStorage.getItem(SSET_PAGE_KEY + secId);
    if (sec.pages.some(p => p.id === v)) return v;
  } catch (_) {}
  return sec.pages[0].id;
};
const writeLastPage = (secId, pageId) => {
  try { window.localStorage.setItem(SSET_PAGE_KEY + secId, pageId); } catch (_) {}
};
// Resolve any id (new section, or an old section id) to [section, page|null].
const ssetResolve = (id) => {
  if (SSET_SECTION[id]) return [id, null];
  if (SSET_LEGACY[id]) return SSET_LEGACY[id];
  return [null, null];
};

// Horizontal room the switcher takes beside the window: its 32px column
// plus an 8px gap. The window's drag / resize clamps reserve it so the
// circles can never be pushed off screen.
const SSET_SW_W = 32;
const SSET_SW_GAP = 8;
const SSET_SW_SPACE = SSET_SW_W + SSET_SW_GAP;
// The top tab: grows out of the window's top edge. Its height is the
// switcher's own 32px thickness, so both docks are the same size. The
// band above the window is reserved on every section — with or without a
// tab — so the window's top edge is in one place for all of them.
const SSET_TOP_H = SSET_SW_W;
const SSET_TOP_GAP = 0;                       // attached: no gap
const SSET_TOP_SPACE = SSET_TOP_H + SSET_TOP_GAP;
// Tab geometry. C: the top corners (half the height, so the end circles
// sit concentric in them). R: the concave shoulders where the tab flows
// into the window's edge. OV: how far the glass reaches down over the
// window's top border so the seam under the tab disappears. INSET: the
// left shoulder starts on the page's content gutter (16px + the window's
// 1px border), so the tab lines up with the search field below it.
const SSET_TAB_C = SSET_TOP_H / 2;
const SSET_TAB_R = 9;
const SSET_TAB_OV = 2;
const SSET_TAB_INSET = 17;
const SSET_TAB_X = SSET_TAB_INSET + SSET_TAB_R;  // window left → tab's own left edge
// Closest a window (moved or not) may come to the viewport's top: room for
// the pill plus an 8px margin above it.
const SSET_TOP_MIN = SSET_TOP_SPACE + 8;

const ensureSettingsDockStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('sset-dock-style')) return;
  const st = document.createElement('style');
  st.id = 'sset-dock-style';
  st.textContent = `
/* Gear — left end of the search field. Sized so it sits 4px in from the
   field's top, bottom and left edges: concentric, not just "inside". */
.sset-gear { position: relative; flex: 0 0 auto; width: 23px; height: 23px; padding: 0; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
  color: rgba(160,164,184,0.52); background: transparent; border: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 140ms ease, color 140ms ease; }
.sset-gear svg { display: block; stroke-width: 1.7; transition: transform 360ms cubic-bezier(0.22,1,0.36,1); }
@media (hover: hover) {
  .sset-gear:hover { color: rgba(226,228,240,0.92); background: rgba(255,255,255,0.055); }
  .sset-gear:hover svg { transform: rotate(45deg); }
}
.sset-gear:active { background: rgba(255,255,255,0.08); }
.sset-gear:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-gear[data-on="1"] { color: color-mix(in oklab, var(--acc, #6c63ff) 35%, #eeeef5);
  background: color-mix(in oklab, var(--acc, #6c63ff) 14%, transparent); }
.sset-search-sep { flex: 0 0 1px; width: 1px; height: 14px; background: rgba(255,255,255,0.07); }

/* Collapsed rail: the gear sits at the BOTTOM of the avatar column, as one
   more circle the exact size of a contact avatar (42px) and on the same
   centre line. Contact rows carry a 2px left border for the active marker,
   so their avatars sit 1px right of the rail's middle; the 2px left pad
   here puts the gear on that same axis. One hairline above it, nothing
   else, so it reads as part of the list rather than a separate toolbar. */
.sset-rbot { flex-shrink: 0; display: flex; justify-content: center; box-sizing: border-box;
  padding: 8px 0 10px 2px; position: relative; }
.sset-rbot::before { content: ""; position: absolute; top: 0; left: 8px; right: 8px; height: 1px;
  background: rgba(255,255,255,0.06); }
.sset-rbot .sset-gear { width: 42px; height: 42px; color: rgba(170,174,196,0.62);
  background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
.sset-rbot .sset-gear svg { width: 18px; height: 18px; stroke-width: 1.6; }
@media (hover: hover) { .sset-rbot .sset-gear:hover { background: rgba(255,255,255,0.07);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12); } }
.sset-rbot .sset-gear[data-on="1"] { box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 45%, transparent); }

/* The window leaves room on both sides for the switcher when centred. */
.sset-subpop { max-width: calc(100vw - ${48 + SSET_SW_SPACE * 2}px); }

/* Section switcher — docked to the window's left edge, top-aligned with its
   squared corner. Position is written straight to the element (see
   placeSwitcher), so it follows a drag or resize in the same frame. */
.sset-switch { position: fixed; left: 0; top: 0; z-index: 9720; width: ${SSET_SW_W}px; box-sizing: border-box;
  /* 4px + the 1px border puts each 22px circle's centre 16px in — the
     centre of the pill's rounded end — so disc and rim are concentric
     with an even 4px gap, never crowding the curve. */
  padding: 4px; display: flex; flex-direction: column; align-items: center; gap: 4px;
  border-radius: 16px;
  /* Same glass as the window (.sset-subpop, v3 surface) so the two read
     as one piece. z-index sits above the scrim (9700) and the window
     (9710); below it, every click was eaten by the scrim. */
  background: rgba(12,13,24,var(--glass-a, 0.66));
  backdrop-filter: blur(24px) saturate(180%) brightness(1.04);
  -webkit-backdrop-filter: blur(24px) saturate(180%) brightness(1.04);
  border: 1px solid rgba(255,255,255,0.09);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.06),
    0 24px 60px -16px rgba(0,0,0,0.65), 0 4px 14px rgba(0,0,0,0.28);
  animation: sset-switch-in 190ms cubic-bezier(0.16,1,0.3,1) both; }
.sset-switch[data-out="1"] { animation: sset-switch-out 150ms cubic-bezier(0.4,0,1,1) both; pointer-events: none; }
@keyframes sset-switch-in  { from { opacity: 0; transform: translateX(6px); } to { opacity: 1; transform: none; } }
@keyframes sset-switch-out { from { opacity: 1; transform: none; } to { opacity: 0; transform: translateX(4px); } }

/* One indicator that slides between circles, instead of each circle
   fading its own background in and out. */
.sset-switch-ind { position: absolute; left: 4px; top: 0; width: 22px; height: 22px; border-radius: 50%;
  background: color-mix(in oklab, var(--acc, #6c63ff) 24%, rgba(255,255,255,0.03));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 50%, transparent);
  transition: transform 220ms cubic-bezier(0.22,1,0.36,1); will-change: transform; pointer-events: none; }
.sset-switch-ind[data-instant="1"] { transition: none; }

.sset-sw { position: relative; z-index: 1; flex: 0 0 auto; width: 22px; height: 22px; padding: 0; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
  color: rgba(160,164,184,0.55); background: transparent; border: none; cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 140ms ease, color 140ms ease; }
.sset-sw svg { display: block; stroke-width: 1.7; }
@media (hover: hover) {
  .sset-sw:not([data-on="1"]):hover { color: rgba(226,228,240,0.92); background: rgba(255,255,255,0.05); }
}
.sset-sw:not([data-on="1"]):active { background: rgba(255,255,255,0.08); }
.sset-sw[data-on="1"] { color: color-mix(in oklab, var(--acc, #6c63ff) 28%, #f2f2f8); cursor: default; }
.sset-sw:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-sw-sep { flex: 0 0 1px; width: 12px; height: 1px; margin: 1px 0; background: rgba(255,255,255,0.08); }
.sset-sw-dot { position: absolute; top: 2.5px; right: 2.5px; width: 5px; height: 5px; border-radius: 50%;
  /* inside the 22px circle, on the glyph's corner — clear of the rim */
  background: color-mix(in oklab, var(--ok, #30d158) 75%, #9aa0a8);
  box-shadow: 0 0 0 1.5px rgba(18,19,34,0.95); pointer-events: none; }

/* Label to the left of a circle, after a short hover. */
.sset-sw::after { content: attr(aria-label); position: absolute; right: calc(100% + 11px); top: 50%;
  transform: translate(4px, -50%); white-space: nowrap; pointer-events: none;
  font-size: 11px; font-weight: 500; letter-spacing: -0.005em; line-height: 1;
  padding: 6px 8px; border-radius: 6px; color: rgba(230,231,240,0.95);
  background: rgba(20,21,36,0.97);
  box-shadow: 0 6px 18px rgba(0,0,0,0.35), inset 0 0 0 0.5px rgba(255,255,255,0.08);
  opacity: 0; transition: opacity 110ms ease, transform 160ms cubic-bezier(0.22,1,0.36,1); }
@media (hover: hover) {
  .sset-sw:hover::after { opacity: 1; transform: translate(0, -50%); transition-delay: 280ms; }
}
.sset-switch[data-out="1"] .sset-sw::after { opacity: 0; transition: none; }

@media (prefers-reduced-motion: reduce) {
  .sset-switch, .sset-switch[data-out="1"] { animation: none; }
  .sset-switch-ind { transition: none; }
  .sset-gear svg { transition: none; transform: none !important; }
}`;
  document.head.appendChild(st);
};

// Which section window is open, and the one close path everything uses.
// Also remembers the last section, which is what the gear opens.
const SSET_LAST_KEY = 'bc.settings.last';
const readLastSection = () => {
  try {
    const v = window.localStorage.getItem(SSET_LAST_KEY);
    const [sec] = ssetResolve(v);
    if (sec) return sec;
  } catch (_) {}
  return SETTINGS_SECTIONS[0].id;
};
const useSettingsPopupCtl = () => {
  const [activeRow, setActiveRow] = React.useState(null);
  const [popClosing, setPopClosing] = React.useState(false);
  const closeTimerRef = React.useRef(0);
  const activeRef = React.useRef(null);
  const lastRef = React.useRef(null);
  if (lastRef.current === null) lastRef.current = readLastSection();
  activeRef.current = popClosing ? null : activeRow;
  React.useEffect(() => () => clearTimeout(closeTimerRef.current), []);

  const closePopup = React.useCallback(() => {
    if (!activeRef.current) return;
    setPopClosing(true);
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => { setActiveRow(null); setPopClosing(false); }, 180);
  }, []);
  const pick = React.useCallback((rawId) => {
    // Accept old section ids too ('llm', 'payments'…): open the section
    // that now holds that page, on that page.
    const [id, page] = ssetResolve(rawId);
    if (!id) return;
    if (SSET_BILLING_TAB[rawId]) BILLING_NAV.go(SSET_BILLING_TAB[rawId]);
    if (page) {
      writeLastPage(id, page);
      try { window.dispatchEvent(new CustomEvent('sset:goto-page', { detail: { section: id, page } })); } catch (_) {}
      if (activeRef.current === id) return;
    }
    const cur = activeRef.current;
    if (cur === id) { closePopup(); return; }
    clearTimeout(closeTimerRef.current);
    // Switching straight between sections: the window keeps its frame and
    // cross-fades its body; it snapshots what it shows NOW, before React
    // replaces it (see SettingsSubPanelPopup).
    if (cur && cur !== id) {
      try { window.dispatchEvent(new CustomEvent('sset:pop-swap', { detail: { from: cur, to: id } })); } catch (_) {}
    }
    lastRef.current = id;
    try { window.localStorage.setItem(SSET_LAST_KEY, id); } catch (_) {}
    setPopClosing(false);
    setActiveRow(id);
  }, [closePopup]);
  // The gear: open the last section, or close whatever is open.
  const toggle = React.useCallback(() => {
    if (activeRef.current) closePopup();
    else pick(lastRef.current || SETTINGS_SECTIONS[0].id);
  }, [closePopup, pick]);

  // The window's own backdrop / Escape, and "open this conversation"
  // requests from inside a section (e.g. a customer on an invoice card).
  React.useEffect(() => {
    const onClose = (e) => {
      if (!activeRef.current) return;
      if (e && e.detail) e.detail.handled = true;
      closePopup();
    };
    const onConv = () => closePopup();
    window.addEventListener('sset:close-popup', onClose);
    window.addEventListener('bc-open-conv', onConv);
    return () => {
      window.removeEventListener('sset:close-popup', onClose);
      window.removeEventListener('bc-open-conv', onConv);
    };
  }, [closePopup]);
  // Jump to another section or page from inside one (e.g. the new-agent
  // wizard's "Add an AI key" link): detail is a section or legacy page id.
  React.useEffect(() => {
    const onOpen = (e) => {
      const id = e && e.detail;
      if (!id) return;
      // Which part of the Connections page to open when it appears.
      const focus = {llm: 'ai', filters: 'allow', platforms: 'telegram'}[id];
      if (focus) window.__cxFocus = focus;
      if (id !== activeRef.current) pick(id);
    };
    window.addEventListener('sset:open', onOpen);
    return () => window.removeEventListener('sset:open', onOpen);
  }, [pick]);

  const closeNow = React.useCallback(() => {
    clearTimeout(closeTimerRef.current); setActiveRow(null); setPopClosing(false);
  }, []);
  return { activeRow, popClosing, pick, toggle, closePopup, closeNow };
};

const usePlatformsLive = () => {
  const [tgConn, dcConn] = useConn();
  return !!((tgConn && tgConn.connected) || (dcConn && dcConn.connected));
};

// The settings entry point: the gear at the left end of the search field
// (and, with `rail`, at the top of the collapsed avatar column).
const SettingsGearButton = React.memo(function SettingsGearButton({on, onClick}) {
  ensureSettingsDockStyles();
  return (
    <button type="button" className="sset-gear" data-on={on ? '1' : '0'}
      onClick={onClick} onMouseDown={e => e.preventDefault()}
      title="Settings" aria-label="Settings" aria-haspopup="dialog" aria-expanded={!!on}>
      <SetIcon size={13}>{SET_GEAR_PATH}</SetIcon>
    </button>
  );
});

// ── Profile button — the "+" left of the gear ───────────────────────
// Opens your profile: the name people see, your @username and link, and
// whether people can find you. It is a settings window like the ones the
// gear opens: same frame, same size, same top line, same glass, same row
// styles (.agx inside .sset-subpop), Esc or a click outside to close.
// Agent replies to BotCommand messages (and replying while offline) live
// with the agents now: Settings → Agents → an agent → Permissions.
const ensureShareBtnStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('sset-plus-style')) return;
  const st = document.createElement('style');
  st.id = 'sset-plus-style';
  st.textContent = `
.sset-gear.sset-plus svg { transition: transform 240ms cubic-bezier(0.22,1,0.36,1); }
@media (hover: hover) { .sset-gear.sset-plus:hover svg { transform: translateY(-1px); } }
.sset-plus-dot { position: absolute; top: 3px; right: 3px; width: 5px; height: 5px; border-radius: 50%;
  background: var(--warn, #ff9f0a); box-shadow: 0 0 0 1.5px rgba(18,19,34,0.95); pointer-events: none; }
.sset-rbot .sset-plus-dot { top: 7px; right: 7px; width: 7px; height: 7px; }
.sset-rbot-stack { display: flex; flex-direction: column; align-items: center; gap: 8px; }

/* ── Profile window ──────────────────────────────────────────────
   A settings window (same frame, width, top line and glass) with the
   settings pages' parts: filled groups, inset hairlines, 12px insets,
   quiet grey hints. The accent only marks what's yours or live: the
   avatar tint, the switch, focus rings and the "Copied" tick. */
.pfw:focus { outline: none; }
.pfw-body { display: flex; flex-direction: column; gap: 10px; padding: 16px var(--gutter, 16px) 16px; }
.pfw-group { border-radius: 10px; overflow: hidden; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); transition: box-shadow 160ms ease; }
.pfw-group:focus-within:has(input:focus) { box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07),
  0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pfw-row { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px; margin: 0; padding: 8px 12px;
  box-sizing: border-box; border: none; background: transparent; color: inherit; font: inherit; text-align: left; }
.pfw-row + .pfw-row { background-image: linear-gradient(rgba(255,255,255,0.055), rgba(255,255,255,0.055));
  background-size: calc(100% - 12px) 1px; background-position: 12px 0; background-repeat: no-repeat; }
button.pfw-row { cursor: pointer; transition: background-color 120ms ease; }
@media (hover: hover) { button.pfw-row:hover:not(:disabled) { background-color: rgba(255,255,255,0.03); } }
button.pfw-row:disabled { cursor: default; opacity: 0.5; }
button.pfw-row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pfw-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.pfw-t { font-size: 12.5px; font-weight: 500; letter-spacing: -0.008em; color: var(--t1, #eeeef5); }
.pfw-s { font-size: 10.5px; line-height: 1.4; color: rgba(160,164,184,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pfw-row[data-tone="warn"] .pfw-t { color: rgb(236,196,130); }

/* You: the same header as your public page (api.php?u=) — photo on the
   left; name (edit in place) and @username on the right. */
.pfw-hero { background: transparent; box-shadow: none; overflow: visible; }
.pfw-me { padding: 4px 2px 6px 4px; gap: 14px; align-items: center; }
.pfw-ava-wrap { position: relative; flex: 0 0 auto; }
.pfw-ava { position: relative; width: 56px; height: 56px; border-radius: 50%; display: grid; place-items: center; flex: 0 0 auto;
  margin: 0; padding: 0; border: none; overflow: hidden; cursor: pointer; font: inherit;
  font-size: 19px; font-weight: 600; letter-spacing: -0.02em; user-select: none;
  color: rgba(214,216,232,0.85);
  background: color-mix(in oklab, var(--acc, #6c63ff) 10%, rgba(255,255,255,0.04));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.pfw-ava img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
.pfw-ava[data-photo="1"] { background: rgba(255,255,255,0.05); }
.pfw-me .pfw-txt { gap: 0; }
.pfw-group.pfw-hero:focus-within:has(input:focus) { box-shadow: none; }
.pfw-me-top { display: flex; align-items: center; gap: 2px; min-width: 0; }
.pfw-me .pfw-edit { opacity: 0.75; }
@media (hover: hover) { .pfw-me .pfw-edit:hover { opacity: 1; } }
/* Hover: a camera over the picture says it can be changed. */
.pfw-ava-cam { position: absolute; inset: 0; display: grid; place-items: center; color: #fff;
  background: rgba(8,9,18,0.55); opacity: 0; transition: opacity 140ms ease; }
@media (hover: hover) { .pfw-ava:hover .pfw-ava-cam { opacity: 1; } }
.pfw-ava:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pfw-ava:focus-visible .pfw-ava-cam, .pfw-ava[data-busy="1"] .pfw-ava-cam { opacity: 1; }
.pfw-ava[data-busy="1"] { cursor: default; }
.pfw-ava[data-busy="1"] .pfw-ava-cam svg { animation: pfw-spin 0.9s linear infinite; }
@keyframes pfw-spin { to { transform: rotate(360deg); } }
.pfw-ava-x { position: absolute; right: -3px; bottom: -3px; width: 17px; height: 17px; padding: 0; border-radius: 50%; cursor: pointer;
  display: grid; place-items: center; color: rgba(214,216,232,0.9); background: rgba(28,29,44,0.98);
  border: 1px solid rgba(255,255,255,0.12); opacity: 0; transition: opacity 140ms ease; }
@media (hover: hover) { .pfw-ava-wrap:hover .pfw-ava-x { opacity: 1; } .pfw-ava-x:hover { color: #fff; background: rgba(48,49,66,0.98); } }
.pfw-ava-x:focus-visible { opacity: 1; outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
@media (hover: none) { .pfw-ava-x { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pfw-ava[data-busy="1"] .pfw-ava-cam svg { animation: none; } }
.pfw-name { grid-area: 1 / 1; min-width: 0; width: 100%; box-sizing: border-box; margin: 0; padding: 2px 6px; border: none; outline: none;
  border-radius: 6px; background: transparent; font: inherit; font-size: 16px; font-weight: 600;
  letter-spacing: -0.012em; color: var(--t1, #eeeef5); text-overflow: ellipsis; transition: background-color 120ms ease; }
/* The name box is as wide as the name (a hidden copy sizes it), so its
   hover/edit highlight hugs the text and the pencil sits right after it. */
.pfw-name-fit { display: inline-grid; min-width: 0; max-width: calc(100% - 28px); margin-left: -6px; }
.pfw-name-fit::after { content: attr(data-v) " "; grid-area: 1 / 1; visibility: hidden; white-space: pre; overflow: hidden;
  box-sizing: border-box; padding: 2px 6px; font: inherit; font-size: 16px; font-weight: 600; letter-spacing: -0.012em; }
.pfw-name::placeholder { color: rgba(160,164,184,0.45); font-weight: 500; }
@media (hover: hover) { .pfw-name:hover:not(:focus):not(:disabled) { background: rgba(255,255,255,0.04); } }
.pfw-name:focus { background: rgba(255,255,255,0.04); }
.pfw-me .pfw-s { padding-left: 0; margin-top: 1px; font-size: 12.5px; color: rgba(160,164,184,0.8); }
.pfw-me .pfw-edit { width: 26px; height: 26px; }
.pfw-edit { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; border: none; border-radius: 7px; cursor: pointer;
  display: grid; place-items: center; background: transparent; color: rgba(160,164,184,0.6);
  transition: background-color 120ms ease, color 120ms ease; }
@media (hover: hover) { .pfw-edit:hover { background: rgba(255,255,255,0.06); color: var(--t1, #eeeef5); } }
.pfw-edit:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

/* Small secondary button (Copy, Confirm) */
.pfw-btn { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 11px; margin: 0;
  border-radius: 8px; font: inherit; font-size: 11.5px; font-weight: 550; cursor: pointer;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease; }
@media (hover: hover) { .pfw-btn:hover:not(:disabled) { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); } }
.pfw-btn:disabled { opacity: 0.4; cursor: default; }
.pfw-btn[data-done="1"] { color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #f3f3f8);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 40%, transparent); background: color-mix(in oklab, var(--acc, #6c63ff) 12%, transparent); }
.pfw-btn[data-v="primary"] { color: #fff; background: color-mix(in oklab, var(--acc, #6c63ff) 88%, #15162a);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 70%, #fff 12%); }
.pfw-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 40%, transparent); }
.pfw-row .bc-switch { flex: 0 0 auto; }
`;
  document.head.appendChild(st);
};

const PfwIco = ({d, s = 13}) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const PFW_I = {
  copy:  <><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></>,
  check: <polyline points="20 6 9 17 4 12"/>,
  pen:   <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  cam:   <><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></>,
  spin:  <path d="M12 3a9 9 0 1 0 9 9"/>,
  x:     <path d="M18 6 6 18M6 6l12 12"/>,
};
// A profile photo as it's stored: the centre square of the picture,
// 256 x 256, as WebP (JPEG where WebP can't be written). Done here so the
// upload is small whatever the camera made.
const pfwMakeAvatar = (file) => new Promise((resolve, reject) => {
  if (!file || !/^image\/(jpeg|png|webp|gif|avif|bmp)$/i.test(file.type || '')) { reject(new Error('Choose a picture (JPG, PNG or WebP).')); return; }
  if (file.size > 20 * 1024 * 1024) { reject(new Error('That picture is too large.')); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    try {
      const S = 256, w = img.naturalWidth, h = img.naturalHeight, side = Math.min(w, h);
      if (!side) throw new Error('That picture couldn’t be opened.');
      const c = document.createElement('canvas');
      c.width = c.height = S;
      const g = c.getContext('2d');
      g.fillStyle = '#15162a'; g.fillRect(0, 0, S, S);
      g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
      g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, S, S);
      let out = c.toDataURL('image/webp', 0.86);
      if (!/^data:image\/webp/.test(out)) out = c.toDataURL('image/jpeg', 0.88);
      resolve(out);
    } catch (e) { reject(e); }
    finally { URL.revokeObjectURL(url); }
  };
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That picture couldn’t be opened.')); };
  img.src = url;
});
const pfwInitials = (name) => String(name || '').trim().split(/\s+/).filter(Boolean)
  .map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';
// "lefty.pro/…/api.php?u=lefty": the host and the part that is yours.
const pfwShortUrl = (url) => {
  const u = String(url || '').replace(/^https?:\/\//, '');
  if (u.length <= 34) return u;
  const slash = u.indexOf('/');
  const host = slash > 0 ? u.slice(0, slash) : u;
  const tail = u.slice(u.lastIndexOf('/') + 1);
  return host + '/…/' + tail;
};

const DmProfileWindow = ({onClose, onKey}) => {
  ensureSsetHeaderStyles();
  ensureSettingsDockStyles();
  ensureShareBtnStyles();
  React.useLayoutEffect(() => { ensurePopupThemeStyles(); });
  useDm();

  // ── Frame: the settings windows' open and close ──
  const [out, setOut] = React.useState(false);
  const ref = React.useRef(null);
  const nameRef = React.useRef(null);
  const outRef = React.useRef(false);
  const close = React.useCallback(() => {
    if (outRef.current) return;
    outRef.current = true;
    setOut(true);
    setTimeout(() => onClose && onClose(), 150);
  }, [onClose]);
  const skipSaveRef = React.useRef(false);
  React.useEffect(() => {
    // Esc closes the window; in the name it only cancels the edit.
    const h = (e) => {
      if (e.key !== 'Escape') return;
      if (document.querySelector('.dmp')) return;
      const a = document.activeElement;
      if (a && a.tagName === 'INPUT' && ref.current && ref.current.contains(a)) {
        e.stopPropagation(); skipSaveRef.current = true; a.blur(); return;
      }
      e.stopPropagation(); close();
    };
    window.addEventListener('keydown', h, true);
    const t = setTimeout(() => { try { ref.current && ref.current.focus({preventScroll: true}); } catch (_) {} }, 40);
    const root = document.documentElement;
    root.setAttribute('data-sset-open', '1'); root.setAttribute('data-sset-pop', 'profile');
    return () => {
      window.removeEventListener('keydown', h, true); clearTimeout(t);
      if (root.getAttribute('data-sset-pop') === 'profile') { root.removeAttribute('data-sset-open'); root.removeAttribute('data-sset-pop'); }
    };
  }, [close]);
  const [size] = React.useState(() => { try { return readPopSize(); } catch (_) { return null; } });

  // ── Name ──
  const acct = AUTH_STORE.account || {};
  const me = DM_KEYS.me || { username: acct.username, display_name: acct.display_name };
  const username = me.username || acct.username || '';
  const shownName = me.display_name || acct.display_name || username || '';
  const [name, setName] = React.useState(shownName);
  const [nameBusy, setNameBusy] = React.useState(false);
  const editingRef = React.useRef(false);
  React.useEffect(() => { if (!editingRef.current) setName(shownName); }, [shownName]);
  const saveName = async () => {
    editingRef.current = false;
    if (skipSaveRef.current) { skipSaveRef.current = false; setName(shownName); return; }
    const v = String(name || '').replace(/\s+/g, ' ').trim();
    if (!v) { setName(shownName); return; }
    if (v === shownName || nameBusy) { setName(v); return; }
    setNameBusy(true);
    try {
      const r = await apiFetch('account_set_name', { display_name: v });
      if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t save your name');
      const nv = r.display_name || v;
      if (AUTH_STORE.account) AUTH_STORE.set({ ...AUTH_STORE.account, display_name: nv });
      if (DM_KEYS.me) DM_KEYS._set({ me: { ...DM_KEYS.me, display_name: nv } });
      setName(nv);
      bcToast('Name updated', 'ok', { detail: nv });
    } catch (e) {
      setName(shownName);
      bcToast(String((e && e.message) || e), 'err');
    } finally { setNameBusy(false); }
  };

  // ── Photo ──
  const photo = (DM_KEYS.me && DM_KEYS.me.avatar) || '';
  const fileRef = React.useRef(null);
  const [photoBusy, setPhotoBusy] = React.useState(false);
  const setPhoto = (avatar) => {
    if (DM_KEYS.me) DM_KEYS._set({ me: { ...DM_KEYS.me, avatar: avatar || null } });
    if (AUTH_STORE.account) AUTH_STORE.set({ ...AUTH_STORE.account, avatar: avatar || null });
  };
  const pickPhoto = async (file) => {
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    try {
      const image = await pfwMakeAvatar(file);
      const r = await apiFetch('account_set_avatar', { image });
      if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t save your photo');
      setPhoto(r.avatar);
      bcToast('Photo updated', 'ok');
    } catch (e) {
      bcToast(String((e && e.message) || e), 'err');
    } finally { setPhotoBusy(false); }
  };
  const removePhoto = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      const r = await apiFetch('account_set_avatar', { remove: 1 });
      if (!r || r.error) throw new Error((r && r.error) || 'Couldn’t remove your photo');
      setPhoto(null);
      bcToast('Photo removed', 'ok');
    } catch (e) {
      bcToast(String((e && e.message) || e), 'err');
    } finally { setPhotoBusy(false); }
  };

  // ── Link and visibility ──
  const url = DM_KEYS.shareUrl;
  const findable = !!DM_KEYS.discoverable;
  const [copied, setCopied] = React.useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); } catch (_) { try { window.prompt('Copy your link', url); } catch (__) {} }
    setCopied(true); setTimeout(() => setCopied(false), 1600);
  };
  const [findBusy, setFindBusy] = React.useState(false);
  const toggleFindable = async () => {
    setFindBusy(true);
    try { await DM_KEYS.setDiscoverable(!findable); }
    catch (e) { bcToast(String((e && e.message) || e), 'err'); }
    finally { setFindBusy(false); }
  };
  // What the profile link shows besides your name and photo.
  const showSeen = DM_KEYS.showSeen !== false;
  const showLinks = DM_KEYS.showLinks !== false;
  // Guests: people messaging you from your link without an account.
  const allowGuests = DM_KEYS.allowGuests !== false;
  const guestAi = DM_KEYS.guestAi !== false;
  const [showBusy, setShowBusy] = React.useState('');
  const toggleShow = async (key, cur) => {
    setShowBusy(key);
    try { await DM_KEYS.setPublicShow(key, !cur); }
    catch (e) { bcToast(String((e && e.message) || e), 'err'); }
    finally { setShowBusy(''); }
  };
  // The accounts the page would list (same rule as dm_public_channels).
  const otherAccts = (() => {
    try {
      const v = (k) => String(CRED_STORE.get(k) || '').trim();
      const out = [];
      const tg = CRED_STORE.getMeta('tg_bot_profile') || {};
      const tgH = String(tg.username || '').trim().replace(/^@/, '');
      if ((v('tg_bot_token') || (v('tg_api_id') && v('tg_phone'))) && /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(tgH)) out.push('Telegram');
      const dc = CRED_STORE.getMeta('dc_bot_profile') || {};
      if (v('dc_bot_token') && String(dc.username || '').trim()) out.push('Discord');
      return out;
    } catch (_) { return []; }
  })();

  // ── Only when this browser needs something ──
  const st = DM_KEYS.state;
  const status = st === 'password' ? { t: 'Confirm your password', s: 'Needed once to open your messages here', act: 'Confirm' }
    : (st === 'ready' && DM_KEYS.needsSync) ? { t: 'Confirm your password', s: 'So your messages open on your other devices', act: 'Confirm' }
    : st === 'unsupported' ? { t: 'Messages aren’t available here', s: 'Private windows block them' }
    : st === 'error' ? { t: 'Messages are unavailable', s: DM_KEYS.error || 'Try again in a moment', act: 'Retry', retry: true }
    : null;

  if (typeof document === 'undefined') return null;
  return ReactDOM.createPortal(
    <>
      <div className={`sset-pop-backdrop${out ? ' sset-pop-backdrop-out' : ''}`} onClick={close}/>
      <aside ref={ref} className={`sset-subpop pfw${out ? ' sset-subpop-out' : ''}`} data-pop="profile" data-fit="1"
        role="dialog" aria-modal="true" aria-label="Profile" tabIndex={-1}
        style={size ? {width: size.w} : undefined}
        onClick={e => e.stopPropagation()}>
        <div className="sset-subpop-body">
          <div className="pfw-body">

            <div className="pfw-group pfw-hero">
              <div className="pfw-row pfw-me">
                <span className="pfw-ava-wrap">
                  <button type="button" className="pfw-ava" data-photo={photo ? '1' : undefined} data-busy={photoBusy ? '1' : undefined}
                    disabled={!acct.id} aria-label={photo ? 'Change your photo' : 'Add a photo'} title={photo ? 'Change your photo' : 'Add a photo'}
                    onClick={() => { if (!photoBusy && fileRef.current) fileRef.current.click(); }}>
                    {photo ? <img src={photo} alt="" draggable={false}/> : <span aria-hidden="true">{pfwInitials(name || shownName || username)}</span>}
                    <span className="pfw-ava-cam" aria-hidden="true"><PfwIco d={photoBusy ? PFW_I.spin : PFW_I.cam} s={15}/></span>
                  </button>
                  {photo && !photoBusy && (
                    <button type="button" className="pfw-ava-x" onClick={removePhoto} aria-label="Remove your photo" title="Remove photo">
                      <PfwIco d={PFW_I.x} s={9}/>
                    </button>
                  )}
                  <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden
                    onChange={e => { const f = e.target.files && e.target.files[0]; e.target.value = ''; pickPhoto(f); }}/>
                </span>
                <span className="pfw-txt">
                  <span className="pfw-me-top">
                    <span className="pfw-name-fit" data-v={name || 'Add your name'}>
                      <input ref={nameRef} className="pfw-name" value={name} maxLength={60} size={1}
                        disabled={nameBusy || !acct.id} placeholder="Add your name" aria-label="Your name" spellCheck={false}
                        onFocus={() => { editingRef.current = true; }}
                        onChange={e => setName(e.target.value)}
                        onBlur={saveName}
                        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.currentTarget.blur(); } }}/>
                    </span>
                    <button type="button" className="pfw-edit" aria-label="Change your name" title="Change your name"
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { const el = nameRef.current; if (el) { el.focus(); el.select(); } }}>
                      <PfwIco d={PFW_I.pen} s={12}/>
                    </button>
                  </span>
                  {username && <span className="pfw-s">@{username}</span>}
                </span>
              </div>
            </div>

            <div className="pfw-group">
              <div className="pfw-row">
                <span className="pfw-txt">
                  <span className="pfw-t">Profile link</span>
                  <span className="pfw-s" title={url && findable ? url : undefined}>
                    {!url ? 'Getting your link…' : findable ? pfwShortUrl(url) : 'Off'}
                  </span>
                </span>
                <button type="button" className="pfw-btn" data-done={copied ? '1' : undefined}
                  disabled={!url || !findable} onClick={copy}>
                  <PfwIco d={copied ? PFW_I.check : PFW_I.copy} s={12}/>{copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <button type="button" className="pfw-row" role="switch" aria-checked={findable}
                disabled={findBusy || !DM_KEYS.acc} onClick={toggleFindable}>
                <span className="pfw-txt">
                  <span className="pfw-t">Let people find me</span>
                </span>
                <span className="bc-switch" data-on={findable ? '1' : '0'} aria-hidden="true"/>
              </button>
              <button type="button" className="pfw-row" role="switch" aria-checked={showSeen}
                disabled={!findable || !!showBusy || !DM_KEYS.acc} onClick={() => toggleShow('show_seen', showSeen)}>
                <span className="pfw-txt">
                  <span className="pfw-t">Show last active</span>
                </span>
                <span className="bc-switch" data-on={showSeen ? '1' : '0'} aria-hidden="true"/>
              </button>
              <button type="button" className="pfw-row" role="switch" aria-checked={showLinks}
                disabled={!findable || !!showBusy || !DM_KEYS.acc} onClick={() => toggleShow('show_links', showLinks)}>
                <span className="pfw-txt">
                  <span className="pfw-t">Show other accounts</span>
                  {showLinks && otherAccts.length > 0 && <span className="pfw-s">{otherAccts.join(', ')}</span>}
                </span>
                <span className="bc-switch" data-on={showLinks ? '1' : '0'} aria-hidden="true"/>
              </button>
            </div>

            <div className="pfw-group">
              <button type="button" className="pfw-row" role="switch" aria-checked={allowGuests}
                disabled={!!showBusy || !DM_KEYS.acc} onClick={() => toggleShow('allow_guests', allowGuests)}>
                <span className="pfw-txt">
                  <span className="pfw-t">Allow guest chats</span>
                  <span className="pfw-s">People can message you without an account</span>
                </span>
                <span className="bc-switch" data-on={allowGuests ? '1' : '0'} aria-hidden="true"/>
              </button>
              <button type="button" className="pfw-row" role="switch" aria-checked={allowGuests && guestAi}
                disabled={!allowGuests || !!showBusy || !DM_KEYS.acc} onClick={() => toggleShow('guest_ai', guestAi)}>
                <span className="pfw-txt">
                  <span className="pfw-t">Agent replies to guests</span>
                  <span className="pfw-s">Capped per guest to protect your AI usage</span>
                </span>
                <span className="bc-switch" data-on={allowGuests && guestAi ? '1' : '0'} aria-hidden="true"/>
              </button>
            </div>

            {status && (
              <div className="pfw-group">
                <div className="pfw-row" data-tone="warn">
                  <span className="pfw-txt">
                    <span className="pfw-t">{status.t}</span>
                    <span className="pfw-s">{status.s}</span>
                  </span>
                  {status.act && (
                    <button type="button" className="pfw-btn" data-v="primary"
                      onClick={() => { if (status.retry) { DM_KEYS.init(AUTH_STORE.account); return; } close(); onKey('access'); }}>
                      {status.act}
                    </button>
                  )}
                </div>
              </div>
            )}

          </div>
        </div>
      </aside>
    </>,
    document.body
  );
};

const DmShareButton = React.memo(function DmShareButton() {
  ensureSettingsDockStyles();
  ensureShareBtnStyles();
  useDm();
  const [open, setOpen] = React.useState(false);
  const [keyMode, setKeyMode] = React.useState(null);
  const attention = dmNeedsAttention();
  return (
    <>
      <button type="button" className="sset-gear sset-plus" data-on={open ? '1' : '0'}
        onClick={() => setOpen(o => !o)} onMouseDown={e => e.preventDefault()}
        title="Share your profile" aria-label="Share your profile" aria-haspopup="dialog" aria-expanded={open}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 14V3"/><polyline points="8 7 12 3 16 7"/><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1"/>
        </svg>
        {attention && <span className="sset-plus-dot" aria-hidden="true"/>}
      </button>
      {open && <DmProfileWindow onClose={() => setOpen(false)} onKey={(m) => setKeyMode(m)}/>}
      {keyMode && <DmAccessPopup onClose={() => setKeyMode(null)}/>}
    </>
  );
});

// ── SETTINGS ON A PHONE ──────────────────────────────────────
// No room for a floating window beside its dock, so on a narrow screen (or
// a phone on its side) the
// settings become one full-screen sheet: the page tabs (or the open item's
// back trail) run across a bar at the top, the section circles become a
// tab bar along the bottom with a close button at its end, and the window
// fills the room between. Dragging and resizing don't apply. Injected
// after the window's own styles, and !important because the window writes
// its position straight onto the elements.
const SSET_PHONE_TOP = SSET_TOP_H + 12;
const SSET_PHONE_BAR = 58;
const ensureSettingsPhoneStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('sset-phone-style')) return;
  const st = document.createElement('style');
  st.id = 'sset-phone-style';
  st.textContent = `
.sset-sw-close { display: none !important; }
.sset-top-title { display: none; }
.sset-top-wallet { display: none; }
@media (max-width: 640px), (max-height: 500px) and (pointer: coarse) {
  .sset-subpop, .sset-subpop[data-tall="1"], .sset-subpop[data-fit="1"] {
    left: 0 !important; right: 0 !important;
    top: calc(${SSET_PHONE_TOP}px + env(safe-area-inset-top)) !important;
    bottom: calc(${SSET_PHONE_BAR}px + env(safe-area-inset-bottom)) !important;
    width: auto !important; height: auto !important; min-width: 0 !important; max-width: none !important;
    min-height: 0 !important; max-height: none !important;
    transform: none !important; border-radius: 0 !important; box-shadow: none !important; border: none !important;
    animation: sset-phone-in 200ms cubic-bezier(0.16,1,0.3,1) both !important; }
  .sset-subpop.sset-subpop-out { animation: sset-phone-out 140ms ease-in both !important; }
  /* An open item has its own back trail at the top; the tab bar steps aside. */
  .sset-subpop[data-focus="1"] { bottom: env(safe-area-inset-bottom) !important; }
  .sset-pop-grab, .sset-pop-resize { display: none !important; }
  .sset-pop-backdrop { background: rgba(4,5,12,0.92); }

  .sset-top { left: 0 !important; right: 0 !important; top: 0 !important; max-width: none !important;
    height: calc(${SSET_PHONE_TOP}px + env(safe-area-inset-top)) !important;
    padding: env(safe-area-inset-top) 10px 0; box-sizing: border-box; align-items: center;
    background: #10111d; border-bottom: 1px solid rgba(255,255,255,0.06);
    pointer-events: auto; overflow-x: auto; scrollbar-width: none; }
  .sset-top::-webkit-scrollbar { display: none; }
  .sset-top-shape { display: none !important; }
  /* The section's name heads the sheet; its page tabs sit to the right. */
  .sset-top-title { display: block; flex: 1 1 auto; min-width: 0; padding: 0 12px 0 6px;
    font-size: 16px; font-weight: 650; letter-spacing: -0.02em; color: var(--t1, #eeeef5);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .sset-top > .sset-tp, .sset-top-port > .sset-tp { flex-shrink: 0; }
  /* Payments: the earnings breakdown opens from here (see ProfitBubble). */
  .sset-top-wallet { display: flex; align-items: center; flex-shrink: 0; order: 9;
    margin-left: 8px; padding-left: 8px; border-left: 1px solid rgba(255,255,255,0.08); height: 22px; }

  .sset-switch { left: 0 !important; right: 0 !important; top: auto !important; bottom: 0 !important; width: auto !important;
    height: calc(${SSET_PHONE_BAR}px + env(safe-area-inset-bottom));
    flex-direction: row; justify-content: space-around; align-items: center; gap: 0;
    padding: 0 6px env(safe-area-inset-bottom); border-radius: 0; border-width: 1px 0 0;
    background: #10111d; box-shadow: none; }
  .sset-switch-ind { display: none; }
  .sset-sw { width: 42px; height: 42px; border-radius: 12px; }
  .sset-sw svg { width: 19px; height: 19px; }
  .sset-sw[data-on="1"] { background: color-mix(in oklab, var(--acc, #6c63ff) 22%, rgba(255,255,255,0.03));
    box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 45%, transparent); }
  .sset-sw::after { display: none; }
  .sset-sw-sep { width: 1px; height: 20px; margin: 0; }
  .sset-sw-dot { top: 8px; right: 8px; }
  .sset-sw-close { display: inline-flex !important; color: rgba(200,203,220,0.75); }
  /* Full-screen surfaces are fully opaque (the "lite" performance mode
     otherwise leaves them at 0.98, and the list shows faintly through). */
  html body .sset-subpop { background: linear-gradient(180deg, #15162a 0%, #11121f 100%) !important; }
  html body .sset-switch, html body .sset-top { background: #10111d !important; }
}
@keyframes sset-phone-in  { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes sset-phone-out { from { opacity: 1; } to { opacity: 0; transform: translateY(6px); } }`;
  document.head.appendChild(st);
};

// The section circles docked to the open window's left edge. `swRef` is
// owned by the window, which positions this element directly.
const SettingsSwitcher = React.memo(function SettingsSwitcher({swRef, activeRow, closing, focus, onSelect, onClose}) {
  ensureSettingsDockStyles();
  ensureSettingsPhoneStyles();
  const live = usePlatformsLive();
  const indRef = React.useRef(null);
  const btnRefs = React.useRef({});
  const placedRef = React.useRef(false);

  // Move the indicator under the active circle. The first placement (the
  // window opening) is instant; after that it slides.
  React.useLayoutEffect(() => {
    const ind = indRef.current;
    const btn = btnRefs.current[activeRow];
    if (!ind || !btn) return;
    const y = btn.offsetTop;
    if (!placedRef.current) {
      placedRef.current = true;
      ind.setAttribute('data-instant', '1');
      ind.style.transform = `translateY(${y}px)`;
      const raf = requestAnimationFrame(() => ind.removeAttribute('data-instant'));
      return () => cancelAnimationFrame(raf);
    }
    ind.style.transform = `translateY(${y}px)`;
  }, [activeRow]);

  const onKeyDown = (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const i = SETTINGS_SECTIONS.findIndex(s => s.id === activeRow);
    const n = SETTINGS_SECTIONS.length;
    const next = SETTINGS_SECTIONS[(i + (e.key === 'ArrowDown' ? 1 : -1) + n) % n].id;
    onSelect(next);
    const b = btnRefs.current[next];
    if (b) b.focus({ preventScroll: true });
  };

  return (
    <nav ref={swRef} className="sset-switch" data-out={closing ? '1' : undefined} data-focus={focus ? '1' : undefined}
      aria-hidden={focus ? 'true' : undefined}
      aria-label="Settings sections" onKeyDown={onKeyDown}
      onClick={e => e.stopPropagation()}>
      <span ref={indRef} className="sset-switch-ind" aria-hidden="true"/>
      {SETTINGS_SECTIONS.map((sec, i) => {
        const on = activeRow === sec.id;
        return (
          <React.Fragment key={sec.id}>
            {sec.group === 2 && i > 0 && <span className="sset-sw-sep" aria-hidden="true"/>}
            <button type="button" className="sset-sw" data-on={on ? '1' : '0'}
              ref={el => { btnRefs.current[sec.id] = el; }}
              aria-label={sec.label} aria-current={on ? 'page' : undefined}
              tabIndex={on ? 0 : -1}
              onMouseDown={e => e.preventDefault()}
              onClick={() => onSelect(sec.id)}>
              <SetIcon size={13}>{SET_ICON_PATHS[sec.id]}</SetIcon>
              {sec.id === 'connections' && live && <span className="sset-sw-dot"/>}
            </button>
          </React.Fragment>
        );
      })}
      {/* Phones only (see SETTINGS ON A PHONE): a full-screen sheet has no
          outside to tap, so the tab bar ends with a way out. */}
      {onClose && (
        <button type="button" className="sset-sw sset-sw-close" aria-label="Close settings" tabIndex={-1}
          onClick={onClose}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      )}
    </nav>
  );
});

// ── SHARED FORM PRIMITIVES (used across every settings sub-popup) ──
// Compact, themed replacements for native <select>, <input type="date">,
// the toggle, and a slim range slider. Keeps every popup looking identical.
// ── Dropdown glyphs ──
// Every dropdown in the popups leads with a small glyph that says what it
// picks (a clock for times, a globe for zones…), or, where it helps more,
// the chosen value itself (the currency symbol, the coin, the AI provider).
const SEL_ICON_PATHS = {
  list:   <><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
  clock:  <><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></>,
  globe:  <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></>,
  moon:   <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>,
  pen:    <><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></>,
  smile:  <><circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/></>,
  hand:   <><path d="M18 11V6a2 2 0 0 0-4 0v5M14 10V4a2 2 0 0 0-4 0v6M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-5.9-2.3L2.8 16.4a2 2 0 0 1 2.8-2.8L7 15"/></>,
  repeat: <><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></>,
  lang:   <><path d="M5 8h10M9 4v4M7 8c0 4 3 7 6 8M13 8c-1 4-4 7-8 8"/><path d="M14 20l4-9 4 9M15.5 17h5"/></>,
  chip:   <><rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4"/></>,
};
const SelIco = ({name, size = 13}) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{SEL_ICON_PATHS[name] || SEL_ICON_PATHS.list}</svg>
);
// The chosen currency as its own glyph: "$", "€"… or the coin's logo.
const CurrencyGlyph = ({code, size = 14}) => {
  const f = (typeof FIAT_CURRENCIES !== 'undefined') && FIAT_CURRENCIES.find(x => x.code === code);
  if (f) return <span className="sel-sym" aria-hidden="true">{f.symbol}</span>;
  const c = (typeof CRYPTAPI_COINS !== 'undefined') && CRYPTAPI_COINS.find(x => x.ticker === code || x.id === code);
  if (c && typeof CoinBadge !== 'undefined') return <CoinBadge coin={c.id} sz={size}/>;
  return <SelIco name="list"/>;
};
// `icon` is a glyph element, or a SEL_ICON_PATHS name. Without one the
// dropdown still gets the neutral list glyph, so none is ever bare.
const SsetSelect = ({value, onChange, options, icon = 'list', placeholder, ...rest}) => (
  <span className="sset-select-wrap" data-icon="1">
    <span className="sset-select-wrap-icon">{typeof icon === 'string' ? <SelIco name={icon}/> : icon}</span>
    <select className="sset-select" value={value||''} onChange={e=>onChange(e.target.value)} {...rest}>
      {placeholder && <option value="" disabled>{placeholder}</option>}
      {options.map(o => (
        typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  </span>
);
const SsetDate = ({value, onChange, ...rest}) => (
  <span className="sset-date-wrap">
    <span className="sset-date-icon">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
        <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
      </svg>
    </span>
    <input type="date" className="sset-date" value={value||''} onChange={e=>onChange(e.target.value)} {...rest}/>
  </span>
);
const SsetTgl = ({checked, onChange}) => (
  <label className="sset-tgl">
    <input type="checkbox" checked={!!checked} onChange={e=>onChange(e.target.checked)}/>
    <span className="sset-tgl-sl"/>
  </label>
);
const SsetRange = ({value, onChange, min=0, max=100, step=1, unit=''}) => (
  <div style={{display:'flex',alignItems:'center',gap:8,minWidth:0,flex:1}}>
    <input type="range" className="sset-range"
      min={min} max={max} step={step} value={value}
      onChange={e=>onChange(Number(e.target.value))}/>
    <span className="sset-range-value">{value}{unit}</span>
  </div>
);

// ── PriceCurrencyPicker ──────────────────────────────────────
// Compact native <select> showing fiats first then cryptos. Used in
// Catalog → Pricing so operators can price products in any fiat OR a
// crypto ticker. Monochrome styling — no flag emoji or coloured icons,
// matches the no-color rule for in-popup pickers.
const PriceCurrencyPicker = ({value, onChange}) => {
  const opts = [
    ...FIAT_CURRENCIES.map(f => ({value:f.code, label:`${f.symbol} ${f.code}`})),
    {value:'__sep__', label:'──────────', disabled:true},
    ...CRYPTAPI_COINS.map(c => ({value:c.ticker, label:cryptoLabel(c.ticker)})),
  ];
  return (
    <span className="sset-select-wrap" data-icon="1">
      <span className="sset-select-wrap-icon"><CurrencyGlyph code={value || 'USD'}/></span>
      <select className="sset-select" value={value||'USD'} onChange={e=>onChange(e.target.value)} aria-label="Currency">
        {opts.map(o => (
          <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
        ))}
      </select>
    </span>
  );
};

// ── SETTINGS MODAL ────────────────────────────────────────────
// Every settings section opens as one centred modal window with a
// consistent header (icon · title · one-line description · close).
// Rendered as a sibling to the contact panel (outside overflow:hidden)
// by MsgList so that backdrop-filter on .sset-sheet doesn't trap
// position:fixed children. MsgList passes activeRow/popClosing down.

// Section names, icons and page descriptions all come from
// SETTINGS_SECTIONS / SET_ICON_PATHS above, so the switcher and the
// window header can never disagree.

const POPUP_TALL = new Set(['connections','agents','catalog','licenses','billing']);

// ── Popup window geometry (drag + resize) ─────────────────────
// The window ALWAYS opens centred. Only the SIZE is remembered; a dragged
// position is session-only. Older builds persisted left/top as well and
// restored them on mount, so a popup that had been nudged aside once kept
// re-opening beside the settings sheet on every later reload — including
// after a refresh, where the operator expects a clean, centred window.
// Double-clicking the top grab strip still re-centres and resets the size.
//
// Why the stamp: size is applied as an INLINE style, so a saved size beats
// any stylesheet default. Once the grip had been dragged even once, every
// later change to the default size was invisible — the popup kept opening
// at the old dimensions and looked like the CSS had not shipped. Each
// record therefore stores the default it was saved against (baseW/baseH);
// when the default changes the record no longer matches and is dropped, so
// a new default always wins once and the operator's own sizing is only
// ever kept within one design.
const POP_GEOM_KEY = 'sset-popup-size-v4';
// Compact frame: 440 x 560 sits in proportion with the contact column and
// the header controls instead of dominating the screen. Changing these
// also drops any size saved against the old default (see readPopSize), so
// everyone opens on the new frame once.
const POP_DEFAULT_W = 440;
const POP_DEFAULT_H = 560;
const POP_MIN_W = 360;
const POP_MIN_H = 300;
// A resized popup must never grow into a page-sized panel again.
const POP_MAX_W = 760;
const POP_MAX_H = 900;
// Every older key carried a saved left/top. Remove them outright so a
// stale position can never be resurrected by an older bundle or a
// half-migrated profile.
['sset-popup-geometry','sset-popup-geometry-v2','sset-popup-geometry-v3'].forEach(k => {
  try { window.localStorage.removeItem(k); } catch (_) {}
});
const readPopSize = () => {
  try {
    const raw = window.localStorage.getItem(POP_GEOM_KEY);
    if (!raw) return null;
    const g = JSON.parse(raw);
    if (!g || typeof g !== 'object') return null;
    const ok = ['w','h'].every(k => typeof g[k] === 'number' && isFinite(g[k]));
    if (!ok) return null;
    // Saved against a different default → discard, don't resurrect.
    if (g.baseW !== POP_DEFAULT_W || g.baseH !== POP_DEFAULT_H) return null;
    if (g.w > POP_MAX_W || g.h > POP_MAX_H) return null;
    if (g.w < POP_MIN_W || g.h < POP_MIN_H) return null;
    return { w: g.w, h: g.h };
  } catch (_) { return null; }
};
const writePopSize = (s) => {
  if (!s) return;
  try {
    window.localStorage.setItem(POP_GEOM_KEY, JSON.stringify(
      {w: s.w, h: s.h, baseW: POP_DEFAULT_W, baseH: POP_DEFAULT_H}
    ));
  } catch (_) {}
};
const clearPopSize = () => {
  try { window.localStorage.removeItem(POP_GEOM_KEY); } catch (_) {}
};

// ── Switching sections without a gap ─────────────────────────
// Styles for the two moving parts of a section switch, injected once:
//   .sset-swap-ghost  — a snapshot of the section being left, laid exactly
//                       over the window and faded out;
//   .sset-body-swapin — the new section's contents settling in beneath it.
// The window frame itself never moves or re-animates during a switch, so
// what the eye reads is the content changing inside a steady window.
const ensureSsetSwapStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('sset-swap-style')) return;
  const st = document.createElement('style');
  st.id = 'sset-swap-style';
  st.textContent = `
@keyframes sset-swap-ghost-out { from { opacity: 1; } to { opacity: 0; } }
@keyframes sset-body-swapin { from { opacity: 0; } to { opacity: 1; } }
.sset-swap-ghost { pointer-events: none !important; }
.sset-subpop-body.sset-body-swapin { animation: sset-body-swapin 140ms ease-out both; }
@media (prefers-reduced-motion: reduce) {
  .sset-subpop-body.sset-body-swapin { animation: none; }
}`;
  document.head.appendChild(st);
};

// ── Page tabs ──────────────────────────────────────────────
// No header: the window opens straight onto its content. A section with
// more than one page (Connections, Store, Preferences) gets one slim row of
// text tabs along the top edge — nothing else. What a page is for is on the
// tab's hover tooltip, the section name is on the switcher circle's, and
// Esc or a click outside closes the window. The row doubles as the drag
// handle; single-page sections use the invisible grab strip instead.
const ensureSsetHeaderStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('sset-hd-style')) return;
  const st = document.createElement('style');
  st.id = 'sset-hd-style';
  st.textContent = `
/* Where every settings window's top edge sits. Worked out from the
   DEFAULT height (not the window's own), so a resized window, a short
   setup-wizard step and a tall one all start on the same line: the eye
   never has to find the top again after a switch. The pill band above
   (${SSET_TOP_SPACE}px) is included, so pill + window are centred as one. */
:root {
  --sset-ref-h: min(${POP_DEFAULT_H}px, calc(100vh - 96px));
  --sset-top: max(${SSET_TOP_MIN}px, calc((100vh - var(--sset-ref-h) + ${SSET_TOP_SPACE}px) / 2));
}
.sset-subpop, .sset-subpop[data-tall="1"] { width: ${POP_DEFAULT_W}px; height: var(--sset-ref-h); }
.sset-hd { flex-shrink: 0; position: relative; z-index: 2; cursor: grab; user-select: none;
  display: flex; align-items: flex-end; gap: 22px; padding: 0 var(--gutter, 18px);
  height: 42px; box-sizing: border-box;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  overflow-x: auto; scrollbar-width: none; }
.sset-hd::-webkit-scrollbar { display: none; }
.sset-hd:active { cursor: grabbing; }
.sset-hd-tab { position: relative; flex: 0 0 auto; appearance: none; background: none; border: none; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; padding: 0 0 11px; margin: 0;
  font: inherit; font-size: 12px; font-weight: 500; letter-spacing: -0.006em; white-space: nowrap;
  color: rgba(160,164,184,0.62); transition: color 140ms ease; }
.sset-hd-tab::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 1px;
  background: transparent; transition: background-color 160ms ease; }
@media (hover: hover) { .sset-hd-tab:hover { color: rgba(226,228,240,0.9); } }
.sset-hd-tab[aria-selected="true"] { color: var(--t1, #eeeef5); }
.sset-hd-tab[aria-selected="true"]::after { background: color-mix(in oklab, var(--acc, #6c63ff) 70%, #ffffff); }
.sset-hd-tab:focus-visible { outline: none; color: var(--t1, #eeeef5); }
.sset-hd-tab:focus-visible::after { background: color-mix(in oklab, var(--acc, #6c63ff) 70%, #ffffff); }
.sset-hd-live { width: 5px; height: 5px; border-radius: 50%;
  background: color-mix(in oklab, var(--ok, #30d158) 75%, #9aa0a8); }

/* ── Store lists (Catalog, Wallets, Invoices) ────────────────────
   One list design for all three: a toolbar of fixed height, then a
   single bordered group of 56px rows split by hairlines. Every row has
   the same four columns — 32px media, name + detail, a right-aligned
   value, trailing controls — so the three pages line up exactly when
   you switch between them. */
.sl-bar { flex-shrink: 0; display: flex; align-items: center; justify-content: space-between; gap: 10px;
  min-height: 30px; padding: 12px var(--gutter, 18px) 10px; box-sizing: content-box; }
.sl-bar-count { font-size: 11.5px; color: rgba(160,164,184,0.7); font-variant-numeric: tabular-nums; letter-spacing: -0.003em; }
.sl-bar-add { flex: 0 0 auto; height: var(--ctl-h, 30px); box-sizing: border-box; padding: 0 11px 0 9px; display: inline-flex; align-items: center; gap: 6px;
  font: inherit; font-size: 11.5px; font-weight: 550; letter-spacing: -0.005em; color: var(--t1, #eeeef5);
  background: rgba(255,255,255,0.055); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ctl-r, 8px); cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease; }
.sl-bar-add svg { opacity: 0.7; }
@media (hover: hover) { .sl-bar-add:hover { background: rgba(255,255,255,0.09); border-color: rgba(255,255,255,0.13); } }
.sl-bar-add:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.sl-filters { display: flex; align-items: center; gap: 16px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.sl-filters::-webkit-scrollbar { display: none; }
.sl-filter { flex: 0 0 auto; appearance: none; background: none; border: none; padding: 4px 0; margin: 0; cursor: pointer;
  display: inline-flex; align-items: baseline; gap: 5px; font: inherit; font-size: 11.5px; font-weight: 500;
  letter-spacing: -0.005em; color: rgba(160,164,184,0.62); transition: color 120ms ease; }
.sl-filter span { font-size: 10.5px; color: rgba(160,164,184,0.45); font-variant-numeric: tabular-nums; }
@media (hover: hover) { .sl-filter:hover { color: rgba(226,228,240,0.9); } }
.sl-filter[aria-pressed="true"] { color: var(--t1, #eeeef5); }
.sl-filter[aria-pressed="true"] span { color: rgba(200,202,220,0.7); }
.sl-filter:focus-visible { outline: none; text-decoration: underline; text-underline-offset: 4px; }

.sl-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding: 0 var(--gutter, 18px) var(--gutter, 18px);
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.10) transparent; }
.sl-list { border: 1px solid rgba(255,255,255,0.065); border-radius: 10px; overflow: hidden;
  background: rgba(255,255,255,0.012); }
.sl-row { display: flex; align-items: center; gap: 12px; height: 56px; padding: 0 12px 0 14px; width: 100%;
  box-sizing: border-box; margin: 0; text-align: left; font: inherit; color: inherit;
  background: transparent; border: none; border-top: 1px solid rgba(255,255,255,0.05);
  cursor: pointer; transition: background-color 120ms ease; }
.sl-row:first-child { border-top: none; }
.sl-row[data-static="1"] { cursor: default; }
@media (hover: hover) { .sl-row:hover { background: rgba(255,255,255,0.028); } }
.sl-row:focus-visible { outline: none; background: rgba(255,255,255,0.035);
  box-shadow: inset 2px 0 0 color-mix(in oklab, var(--acc, #6c63ff) 75%, #fff); }
.sl-row-media { flex: 0 0 32px; width: 32px; height: 32px; display: inline-flex; align-items: center; justify-content: center; }
.sl-row-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.sl-row-title { font-size: 12.5px; font-weight: 550; line-height: 1.2; letter-spacing: -0.008em; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sl-row-meta { display: flex; align-items: center; gap: 6px; min-width: 0; font-size: 11px; line-height: 1.2;
  color: rgba(160,164,184,0.66); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; }
/* Every detail keeps its full width; only the one marked .sl-grow (a
   customer, product or address) gives way and ends in an ellipsis. */
.sl-row-meta > * { flex: 0 0 auto; }
.sl-row-meta > .sl-grow { flex: 0 1 auto; min-width: 24px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-row-meta > button.sl-grow { text-align: left; }
.sl-row-meta .sl-sep { flex: 0 0 auto; opacity: 0.45; }
.sl-row-mono { font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; letter-spacing: 0; }
.sl-row-link { appearance: none; background: none; border: none; padding: 0; margin: 0; font: inherit; color: inherit;
  cursor: pointer; transition: color 120ms ease; }
@media (hover: hover) { .sl-row-link:hover { color: var(--t1, #eeeef5); text-decoration: underline; text-underline-offset: 2px; } }
.sl-row-value { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; text-align: right;
  padding-left: 4px; }
.sl-row-amt { font-size: 12.5px; font-weight: 550; line-height: 1.2; color: var(--t1, #eeeef5);
  font-variant-numeric: tabular-nums; letter-spacing: -0.005em; white-space: nowrap; }
.sl-row-amt[data-muted="1"] { color: rgba(160,164,184,0.7); font-weight: 500; }
.sl-row-amt-sub { font-size: 11px; line-height: 1.2; color: rgba(160,164,184,0.6); font-variant-numeric: tabular-nums; white-space: nowrap; }
.sl-row-trail { flex: 0 0 auto; display: flex; align-items: center; gap: 10px; }
.sl-row-chev { flex: 0 0 auto; color: rgba(160,164,184,0.38); }
.sl-row[data-off="1"] .sl-row-media,
.sl-row[data-off="1"] .sl-row-main,
.sl-row[data-off="1"] .sl-row-value { opacity: 0.45; }
.sl-stat { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto !important; }
.sl-stat i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; flex: 0 0 auto; }
.sl-stat[data-s="pending"]   { color: rgb(222,168,92); }
.sl-stat[data-s="confirmed"] { color: rgb(88,190,140); }
.sl-stat[data-s="failed"]    { color: rgb(230,110,104); }
.sl-stat[data-s="expired"], .sl-stat[data-s="cancelled"] { color: rgba(160,164,184,0.75); }
.sl-act { width: 26px; height: 26px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 6px; cursor: pointer; background: transparent; border: none; color: rgba(160,164,184,0.7);
  transition: background-color 120ms ease, color 120ms ease; }
.sl-act:hover { background: rgba(255,255,255,0.07); color: var(--t1, #eeeef5); }
.sl-act[data-tone="ok"]:hover { color: rgb(88,190,140); }
.sl-act[data-tone="danger"]:hover { color: rgb(230,110,104); background: rgba(230,110,104,0.08); }
.sl-act:disabled { opacity: 0.4; cursor: wait; }
.sl-act:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.sl-act[aria-expanded="true"] { background: rgba(255,255,255,0.08); color: var(--t1, #eeeef5); }
/* Row action menu (the "…" button at the end of a row). */
.sl-menu { position: fixed; z-index: 10000; min-width: 176px; padding: 4px; box-sizing: border-box;
  background: rgba(22,23,38,0.985); border: 1px solid rgba(255,255,255,0.09); border-radius: 9px;
  box-shadow: 0 14px 36px rgba(0,0,0,0.55), 0 2px 8px rgba(0,0,0,0.35);
  animation: sl-menu-in 120ms cubic-bezier(0.16,1,0.3,1) both; }
@keyframes sl-menu-in { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }
.sl-menu-item { display: flex; align-items: center; gap: 9px; width: 100%; height: 30px; padding: 0 10px; margin: 0;
  box-sizing: border-box; font: inherit; font-size: 12px; font-weight: 500; letter-spacing: -0.005em; text-align: left;
  color: var(--t1, #eeeef5); background: transparent; border: none; border-radius: 6px; cursor: pointer; }
.sl-menu-item svg { flex: 0 0 auto; color: rgba(160,164,184,0.75); }
.sl-menu-item:hover:not(:disabled), .sl-menu-item:focus-visible { outline: none; background: rgba(255,255,255,0.065); }
.sl-menu-item:disabled { opacity: 0.45; cursor: default; }
.sl-menu-item[data-tone="danger"], .sl-menu-item[data-tone="danger"] svg { color: rgb(236,116,110); }
.sl-menu-item[data-tone="danger"]:hover { background: rgba(230,110,104,0.1); }
.sl-menu-sep { height: 1px; margin: 4px 2px; background: rgba(255,255,255,0.07); }
.sl-empty { padding: 40px 20px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 5px; }
.sl-empty-title { font-size: 12.5px; font-weight: 550; color: var(--t2, #c8c9d8); }
.sl-empty-sub { font-size: 11.5px; color: rgba(160,164,184,0.6); max-width: 280px; line-height: 1.45; }

/* Search field in a list toolbar. */
.sl-search { position: relative; flex: 1 1 auto; min-width: 0; display: flex; align-items: center; }
.sl-search > svg { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: rgba(160,164,184,0.55); pointer-events: none; }
.sl-search input { width: 100%; height: var(--ctl-h, 30px); box-sizing: border-box; padding: 0 28px 0 30px; margin: 0;
  font: inherit; font-size: 11.5px; letter-spacing: -0.005em; color: var(--t1, #eeeef5);
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.07); border-radius: var(--ctl-r, 8px); outline: none;
  transition: border-color 120ms ease, background-color 120ms ease; }
.sl-search input::placeholder { color: rgba(160,164,184,0.5); }
.sl-search input:focus { border-color: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); background: rgba(255,255,255,0.05); }
.sl-search input::-webkit-search-cancel-button { display: none; }
.sl-search-clear { position: absolute; right: 5px; top: 50%; transform: translateY(-50%); width: 20px; height: 20px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center; border: none; border-radius: 5px; cursor: pointer;
  background: transparent; color: rgba(160,164,184,0.6); }
.sl-search-clear:hover { background: rgba(255,255,255,0.07); color: var(--t1, #eeeef5); }
.sl-bar.sl-bar-2 { min-height: 22px; padding-top: 0; padding-bottom: 10px; }
.sl-bar-note { flex: 0 0 auto; font-size: 11px; color: rgba(160,164,184,0.55); font-variant-numeric: tabular-nums; }
/* "Show more" at the end of a long list. */
.sl-more { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; height: 40px; margin: 0;
  font: inherit; font-size: 11.5px; font-weight: 500; color: rgba(160,164,184,0.8); background: transparent; border: none;
  border-top: 1px solid rgba(255,255,255,0.05); cursor: pointer; }
.sl-more:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.025); }
.sl-more span { color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }
.sl-avatar { width: 32px; height: 32px; border-radius: 50%; object-fit: cover; flex: 0 0 auto; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: var(--t2, #c8c9d8);
  background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.08); }
.sl-stat[data-s="active"]    { color: rgb(88,190,140); }
.sl-stat[data-s="expiring"], .sl-stat[data-s="suspended"] { color: rgb(222,168,92); }

/* ── Wallet editor (Store → Payments → New wallet / edit) ────────── */
.slw-ed { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.slw-ed-title { display: flex; align-items: center; gap: 10px; min-width: 0; }
.slw-ed-title strong { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slw-back { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border-radius: 7px; border: none; background: transparent; color: rgba(160,164,184,0.75); cursor: pointer; }
.slw-back:hover { background: rgba(255,255,255,0.06); color: var(--t1, #eeeef5); }
.slw-body { display: flex; flex-direction: column; gap: 20px; padding-top: 4px; }
.slw-field { display: flex; flex-direction: column; gap: 7px; }
.slw-label { font-size: 11.5px; font-weight: 550; color: var(--t2, #c8c9d8); letter-spacing: -0.005em; }
.slw-label small { font-size: 11px; font-weight: 400; color: rgba(160,164,184,0.55); margin-left: 4px; }
.slw-hint { font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.6); }
.slw-input { width: 100%; height: var(--ctl-h, 30px); box-sizing: border-box; padding: 0 var(--ctl-px, 10px); margin: 0;
  font: inherit; font-size: 11.5px; color: var(--t1, #eeeef5); background: rgba(255,255,255,0.035);
  border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ctl-r, 8px); outline: none; transition: border-color 120ms ease, background-color 120ms ease; }
.slw-input::placeholder { color: rgba(160,164,184,0.45); }
.slw-input:focus { border-color: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); background: rgba(255,255,255,0.05); }
.slw-mono { font-family: var(--mono, ui-monospace, monospace); font-size: 11px; letter-spacing: 0; }
.slw-coins { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.slw-coin { position: relative; display: flex; align-items: center; gap: 9px; height: 44px; padding: 0 10px; margin: 0; min-width: 0;
  box-sizing: border-box; font: inherit; text-align: left; color: var(--t1, #eeeef5); cursor: pointer;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px;
  transition: border-color 120ms ease, background-color 120ms ease; }
@media (hover: hover) { .slw-coin:hover:not(:disabled) { background: rgba(255,255,255,0.045); border-color: rgba(255,255,255,0.12); } }
.slw-coin[aria-checked="true"] { background: color-mix(in oklab, var(--acc, #6c63ff) 10%, transparent);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 65%, transparent); }
.slw-coin:disabled { cursor: default; opacity: 0.4; }
.slw-coin:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.slw-coin-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.slw-coin-name { font-size: 11.5px; font-weight: 550; letter-spacing: -0.005em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slw-coin-net { font-size: 10px; color: rgba(160,164,184,0.6); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slw-other-ico { width: 20px; height: 20px; flex: 0 0 auto; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  border: 1px dashed rgba(255,255,255,0.22); color: rgba(160,164,184,0.8); }
.slw-fixed { display: flex; align-items: center; gap: 11px; height: 48px; padding: 0 12px; box-sizing: border-box;
  background: rgba(255,255,255,0.02); border: 1px solid rgba(255,255,255,0.07); border-radius: 8px; }
.slw-fixed .slw-coin-name { font-size: 12.5px; }
.slw-setrow { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 0 14px; box-sizing: border-box;
  border-top: 1px solid rgba(255,255,255,0.05); }
.slw-setrow:first-child { border-top: none; }
.slw-setrow-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.slw-setrow-title { font-size: 12.5px; font-weight: 550; color: var(--t1, #eeeef5); letter-spacing: -0.008em; }
.slw-step { flex: 0 0 auto; display: inline-flex; align-items: center; height: var(--ctl-h, 30px); box-sizing: border-box; border-radius: var(--ctl-r, 8px);
  border: 1px solid rgba(255,255,255,0.08); background: rgba(255,255,255,0.03); overflow: hidden; }
.slw-step button { width: 30px; height: 100%; padding: 0; border: none; background: transparent; color: rgba(160,164,184,0.85);
  cursor: pointer; font: inherit; font-size: 15px; line-height: 1; }
.slw-step button:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: var(--t1, #eeeef5); }
.slw-step button:disabled { opacity: 0.35; cursor: default; }
.slw-step output { min-width: 30px; text-align: center; font-size: 12.5px; font-weight: 600; color: var(--t1, #eeeef5);
  font-variant-numeric: tabular-nums; border-left: 1px solid rgba(255,255,255,0.06); border-right: 1px solid rgba(255,255,255,0.06);
  line-height: 28px; }
.slw-foot { flex-shrink: 0; display: flex; align-items: center; gap: 8px; padding: 10px var(--gutter, 18px); border-top: 1px solid rgba(255,255,255,0.06); }
.slw-foot-sp { flex: 1 1 auto; }
.slw-link-danger { appearance: none; background: none; border: none; padding: 6px 4px; margin: 0; font: inherit; font-size: 11.5px; font-weight: 500;
  color: rgba(230,110,104,0.85); cursor: pointer; border-radius: 6px; }
.slw-link-danger:hover { color: rgb(240,125,118); background: rgba(230,110,104,0.07); }
@media (max-width: 440px) { .slw-coins { grid-template-columns: repeat(2, minmax(0, 1fr)); } }

/* ── Top tab (grows out of the window's top edge) ───────────────────
   One slot, sitting on the window's top edge. Whatever the window is
   showing, it holds exactly one row:
     .sset-tp     the page's own tabs (Agents, Catalog, Licenses &
                  payments, Preferences) as symbol circles
     .sset-crumb  while an item is open: back circle, the list's glyph
                  and the item's name
   Behind the row is ONE piece of glass, .sset-top-shape: a tab with
   rounded top corners and two concave shoulders that curve out into the
   window's border, like a folder tab. Its outline (.sset-top-line) runs
   from the window's edge, up around the tab and back down, as one line.
   The glass is the window's own (same fill, same blur) and reaches 2px
   down over the window's top border, so there is no seam where they
   meet. When the row changes, the shape keeps its left edge and only
   its width eases to the new row, so the tab morphs rather than blinks.
   The window's top edge never moves (see --sset-top), so neither does
   the tab. */
.sset-top { position: fixed; left: 0; top: 0; z-index: 9716; display: flex; align-items: flex-start;
  height: ${SSET_TOP_H}px; max-width: min(560px, calc(100vw - 32px)); pointer-events: none;
  --tab-r: ${SSET_TAB_R}px; --tab-c: ${SSET_TAB_C}px; --tab-ov: ${SSET_TAB_OV}px;
  --tab-line: rgba(255,255,255,0.09); }
/* Closing: each part fades on its own. Fading the slot itself would turn
   it into a backdrop root and strip the tab's blur for the whole fade. */
/* (The shape's own rule already transitions opacity along with width.) */
.sset-top > .sset-tp, .sset-top > .sset-crumb, .sset-top-port > .sset-tp {
  transition: opacity 140ms ease; }
.sset-top[data-out="1"] > .sset-top-shape, .sset-top[data-out="1"] > .sset-tp,
.sset-top[data-out="1"] > .sset-crumb, .sset-top[data-out="1"] .sset-top-port > .sset-tp { opacity: 0; }
.sset-top[data-out="1"] * { pointer-events: none !important; }
.sset-top-port { display: contents; }
/* One row at a time: an open item's trail wins over the page tabs. */
.sset-top > .sset-crumb ~ .sset-top-port,
.sset-top > .sset-tp ~ .sset-top-port { display: none; }

/* The glass. Width is written by the window (row width + both shoulders)
   and eased; every mask piece is sized from it, so the silhouette is
   exact at every frame of the ease. Pieces: body below the corners, the
   strip between the corners, the two corners, the two shoulders. */
.sset-top-shape { position: absolute; left: calc(var(--tab-r) * -1); top: 0; width: 0;
  height: calc(100% + var(--tab-ov)); pointer-events: auto; cursor: grab;
  background: rgba(12,13,24,var(--glass-a, 0.66));
  backdrop-filter: blur(24px) saturate(170%) brightness(1.04);
  -webkit-backdrop-filter: blur(24px) saturate(170%) brightness(1.04);
  --m: linear-gradient(#000, #000);
  -webkit-mask-image: var(--m), var(--m),
    radial-gradient(circle at 100% 100%, #000 calc(var(--tab-c) - 0.5px), transparent var(--tab-c)),
    radial-gradient(circle at 0 100%,    #000 calc(var(--tab-c) - 0.5px), transparent var(--tab-c)),
    radial-gradient(circle at 0 0,       transparent calc(var(--tab-r) - 0.5px), #000 calc(var(--tab-r) + 0.5px)),
    radial-gradient(circle at 100% 0,    transparent calc(var(--tab-r) - 0.5px), #000 calc(var(--tab-r) + 0.5px));
  mask-image: var(--m), var(--m),
    radial-gradient(circle at 100% 100%, #000 calc(var(--tab-c) - 0.5px), transparent var(--tab-c)),
    radial-gradient(circle at 0 100%,    #000 calc(var(--tab-c) - 0.5px), transparent var(--tab-c)),
    radial-gradient(circle at 0 0,       transparent calc(var(--tab-r) - 0.5px), #000 calc(var(--tab-r) + 0.5px)),
    radial-gradient(circle at 100% 0,    transparent calc(var(--tab-r) - 0.5px), #000 calc(var(--tab-r) + 0.5px));
  -webkit-mask-size:
    calc(100% - 2 * var(--tab-r)) calc(100% - var(--tab-c)),
    calc(100% - 2 * var(--tab-r) - 2 * var(--tab-c)) var(--tab-c),
    var(--tab-c) var(--tab-c), var(--tab-c) var(--tab-c),
    calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov)), calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov));
  mask-size:
    calc(100% - 2 * var(--tab-r)) calc(100% - var(--tab-c)),
    calc(100% - 2 * var(--tab-r) - 2 * var(--tab-c)) var(--tab-c),
    var(--tab-c) var(--tab-c), var(--tab-c) var(--tab-c),
    calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov)), calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov));
  -webkit-mask-position:
    var(--tab-r) var(--tab-c), calc(var(--tab-r) + var(--tab-c)) 0,
    left var(--tab-r) top 0, right var(--tab-r) top 0,
    left 0 bottom 0, right 0 bottom 0;
  mask-position:
    var(--tab-r) var(--tab-c), calc(var(--tab-r) + var(--tab-c)) 0,
    left var(--tab-r) top 0, right var(--tab-r) top 0,
    left 0 bottom 0, right 0 bottom 0;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  transition: width 240ms cubic-bezier(0.22,1,0.36,1), opacity 140ms ease;
  /* backwards, not both: a held end frame would pin opacity at 1 and
     defeat the empty / closing fades below. */
  animation: sset-top-in 180ms ease-out backwards; }
.sset-top-shape[data-instant="1"] { transition: opacity 140ms ease; }
.sset-top-shape[data-empty="1"] { opacity: 0; pointer-events: none; }
.sset-top-shape:active { cursor: grabbing; }

/* The outline, drawn in the same pieces: top edge (plus the faint inner
   highlight the window has along its own top), two corner arcs, two short
   sides, two shoulder arcs that land exactly on the window's border. */
.sset-top-line { position: absolute; inset: 0; pointer-events: none;
  --l: linear-gradient(var(--tab-line), var(--tab-line));
  background-image:
    var(--l),
    linear-gradient(rgba(255,255,255,0.06), rgba(255,255,255,0.06)),
    radial-gradient(circle at 100% 100%, transparent calc(var(--tab-c) - 1.6px), var(--tab-line) calc(var(--tab-c) - 1px), var(--tab-line) calc(var(--tab-c) - 0.4px), transparent var(--tab-c)),
    radial-gradient(circle at 0 100%,    transparent calc(var(--tab-c) - 1.6px), var(--tab-line) calc(var(--tab-c) - 1px), var(--tab-line) calc(var(--tab-c) - 0.4px), transparent var(--tab-c)),
    var(--l), var(--l),
    radial-gradient(circle at 0 0,    transparent calc(var(--tab-r) - 0.4px), var(--tab-line) calc(var(--tab-r) + 0.2px), var(--tab-line) calc(var(--tab-r) + 0.8px), transparent calc(var(--tab-r) + 1.4px)),
    radial-gradient(circle at 100% 0, transparent calc(var(--tab-r) - 0.4px), var(--tab-line) calc(var(--tab-r) + 0.2px), var(--tab-line) calc(var(--tab-r) + 0.8px), transparent calc(var(--tab-r) + 1.4px));
  background-size:
    calc(100% - 2 * var(--tab-r) - 2 * var(--tab-c)) 1px,
    calc(100% - 2 * var(--tab-r) - 2 * var(--tab-c)) 1px,
    var(--tab-c) var(--tab-c), var(--tab-c) var(--tab-c),
    1px calc(100% - var(--tab-ov) - var(--tab-r) - var(--tab-c)),
    1px calc(100% - var(--tab-ov) - var(--tab-r) - var(--tab-c)),
    calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov)), calc(var(--tab-r) + 1px) calc(var(--tab-r) + var(--tab-ov));
  background-position:
    calc(var(--tab-r) + var(--tab-c)) 0, calc(var(--tab-r) + var(--tab-c)) 1px,
    left var(--tab-r) top 0, right var(--tab-r) top 0,
    left var(--tab-r) top var(--tab-c), right var(--tab-r) top var(--tab-c),
    left 0 bottom 0, right 0 bottom 0;
  background-repeat: no-repeat; }

/* The row itself carries no surface of its own; the shape is its glass. */
.sset-tp, .sset-crumb { position: relative; flex: 0 1 auto; min-width: 0; pointer-events: auto;
  /* 5px all round: the same inset the switcher's circles have, and the
     circles' centres land on the centres of the tab's 16px corners, so
     disc and outline are concentric. Equal room below, to the window. */
  height: ${SSET_TOP_H}px; box-sizing: border-box; padding: 5px; margin: 0;
  display: flex; align-items: center; gap: 4px; background: none; border: none;
  cursor: grab; user-select: none; -webkit-user-select: none;
  /* Opacity only: the row never slides, so the eye has nothing to chase. */
  animation: sset-top-in 160ms 40ms ease-out backwards; }
.sset-tp:active, .sset-crumb:active { cursor: grabbing; }
@keyframes sset-top-in { from { opacity: 0; } to { opacity: 1; } }

/* The accent disc under the chosen circle — slides, like the switcher's. */
.sset-tp-ind { position: absolute; left: 0; top: 5px; width: 22px; height: 22px; border-radius: 50%;
  background: color-mix(in oklab, var(--acc, #6c63ff) 24%, rgba(255,255,255,0.03));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 50%, transparent);
  transition: transform 220ms cubic-bezier(0.22,1,0.36,1), opacity 120ms ease;
  will-change: transform; pointer-events: none; }
.sset-tp-ind[data-instant="1"] { transition: none; }
.sset-tp-ind[data-hide="1"] { opacity: 0; }

.sset-tp-btn, .sset-crumb-back { position: relative; z-index: 1; flex: 0 0 auto; width: 22px; height: 22px; padding: 0; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 50%;
  color: rgba(160,164,184,0.55); background: transparent; border: none; cursor: pointer; font: inherit;
  -webkit-tap-highlight-color: transparent;
  transition: background-color 140ms ease, color 140ms ease; }
.sset-tp-btn svg, .sset-crumb-back svg { display: block; stroke-width: 1.7; opacity: 1; }
@media (hover: hover) {
  .sset-tp-btn:not([aria-selected="true"]):hover, .sset-crumb-back:hover {
    color: rgba(226,228,240,0.92); background: rgba(255,255,255,0.05); }
}
.sset-tp-btn:not([aria-selected="true"]):active, .sset-crumb-back:active { background: rgba(255,255,255,0.08); }
.sset-tp-btn[aria-selected="true"] { color: color-mix(in oklab, var(--acc, #6c63ff) 28%, #f2f2f8); cursor: default; }
.sset-tp-btn[aria-selected="true"] > .tab-ico { color: inherit; opacity: 1; }
.sset-tp-btn:focus-visible, .sset-crumb-back:focus-visible { outline: none;
  box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-tp-sep { flex: 0 0 1px; width: 1px; height: 14px; margin: 0 1px; background: rgba(255,255,255,0.08); }
/* Something on that page wants attention (as on the switcher's circles). */
.sset-tp-dot { position: absolute; top: 2.5px; right: 2.5px; width: 5px; height: 5px; border-radius: 50%;
  box-shadow: 0 0 0 1.5px rgba(18,19,34,0.95); pointer-events: none;
  background: color-mix(in oklab, var(--ok, #30d158) 75%, #9aa0a8); }
.sset-tp-dot[data-tone="warn"] { background: rgb(222,168,92); }
.sset-tp-dot[data-tone="err"]  { background: rgb(230,110,104); }

/* Label under a circle after a short hover (the switcher's, turned 90°). */
.sset-tp-btn::after, .sset-crumb-back::after { content: attr(data-tip); position: absolute; left: 50%; top: calc(100% + 11px);
  transform: translate(-50%, -3px); white-space: nowrap; pointer-events: none;
  font-size: 11px; font-weight: 500; letter-spacing: -0.005em; line-height: 1;
  padding: 6px 8px; border-radius: 6px; color: rgba(230,231,240,0.95);
  background: rgba(20,21,36,0.97);
  box-shadow: 0 6px 18px rgba(0,0,0,0.35), inset 0 0 0 0.5px rgba(255,255,255,0.08);
  opacity: 0; transition: opacity 110ms ease, transform 160ms cubic-bezier(0.22,1,0.36,1); }
@media (hover: hover) {
  .sset-tp-btn:hover::after, .sset-crumb-back:hover::after { opacity: 1; transform: translate(-50%, 0); transition-delay: 280ms; }
}
.sset-tp-btn:focus-visible::after, .sset-crumb-back:focus-visible::after { opacity: 1; transform: translate(-50%, 0); }
.sset-top[data-out="1"] .sset-tp-btn::after, .sset-top[data-out="1"] .sset-crumb-back::after { opacity: 0; transition: none; }

/* Open item: [‹]  |  glyph  Item name */
.sset-crumb { gap: 0; padding-right: 14px; max-width: 100%; }
.sset-crumb-back svg { width: 12px; height: 12px; }
.sset-crumb-sep { flex: 0 0 1px; width: 1px; height: 14px; margin: 0 9px 0 5px; background: rgba(255,255,255,0.08); }
.sset-crumb-ico { flex: 0 0 auto; display: inline-flex; margin-right: 7px;
  color: color-mix(in oklab, var(--acc, #6c63ff) 28%, #f2f2f8); }
.sset-crumb-ico svg { display: block; stroke-width: 1.7; opacity: 1; }
.sset-crumb-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; font-weight: 500; line-height: 16px; letter-spacing: -0.005em; color: rgba(236,238,248,0.95); }
.sset-switch[data-focus="1"] { animation: none !important; opacity: 0; pointer-events: none; transform: translateX(6px);
  visibility: hidden; transition: opacity 140ms ease, transform 140ms ease, visibility 0s linear 140ms; }
.sset-switch { transition: opacity 140ms ease, transform 140ms ease; }
/* An open item starts straight under the window edge. */
.sset-subpop[data-focus="1"] .slw-ed > .sset-pop-tabs.slp-tabs,
.sset-subpop[data-focus="1"] .slw-ed > .sset-pop-tabs { margin-top: 14px; }
.sset-subpop[data-focus="1"] .ag-tabrow { margin-top: 14px; }
.slp-scroll > .slw-body { padding-top: 0; }
@media (prefers-reduced-motion: reduce) {
  .sset-tp, .sset-crumb, .sset-top-shape { animation: none; } .sset-switch, .sset-top > *, .sset-top-shape { transition: none; }
  .sset-tp-ind { transition: none; }
}

/* ── Product editor (Store → Catalog) ────────────────────────────
   Built to fit a default-size window without scrolling on Details:
   one compact title row, the tabs, then fields on a 14px rhythm with
   6px between a label and its control. */
.slw-ed > .sl-bar { padding-top: 10px; padding-bottom: 8px; }
.sset-subpop .sset-pop-tabs.slp-tabs { margin: 0 var(--gutter, 18px); }
.sl-scroll.slp-scroll { padding-top: 14px; }
.slw-body.slp-body { gap: 14px; padding-top: 0; }
.slp-body .slw-field { gap: 6px; }
.slp-body[data-fill="1"] { min-height: 100%; box-sizing: border-box; }
.slp-grid-2 { display: grid; grid-template-columns: minmax(0, 1fr) 132px; gap: 10px; }
.slp-grid-even { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 10px; }
.slp-grid-price { display: grid; grid-template-columns: 112px minmax(0, 1fr) 124px; gap: 10px; }
.slp-group-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.slp-group-hint { margin-top: -2px; }
.slp-label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
.slp-count { font-size: 11px; font-weight: 400; color: rgba(160,164,184,0.55); font-variant-numeric: tabular-nums; }
.slp-count[data-warn="1"] { color: rgb(222,168,92); }

/* Image: one row — preview, link field, Upload, remove. */
.slp-img { display: flex; align-items: center; gap: 6px; border-radius: var(--ctl-r, 8px); }
.slp-img[data-drag="1"] { box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.slp-img .slw-input { flex: 1 1 auto; min-width: 0; }
.slp-img-tile { flex: 0 0 auto; width: var(--ctl-h, 30px); height: var(--ctl-h, 30px); padding: 0; margin: 0; overflow: hidden;
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(160,164,184,0.65);
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ctl-r, 8px);
  transition: border-color 120ms ease; }
.slp-img-tile[data-empty="1"] { border-style: dashed; border-color: rgba(255,255,255,0.16); }
.slp-img-tile:hover { border-color: color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.slp-img-tile:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.slp-img-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.slp-img .sl-act { width: var(--ctl-h, 30px); height: var(--ctl-h, 30px); flex: 0 0 auto; }
.slp-img-note { font-size: 11px; font-weight: 400; color: rgba(160,164,184,0.6); font-variant-numeric: tabular-nums; }
.slp-img-note[data-err="1"] { color: rgb(236,130,124); }

/* Description fills whatever height is left; Features sits under it.
   Selectors are deliberately stronger than the shared textarea rules. */
.slp-desc { flex: 1 1 auto; min-height: 0; }
.sset-subpop .slp-desc textarea.slp-desc-input, .slp-desc textarea.slp-desc-input {
  flex: 1 1 auto; min-height: 120px !important; resize: none; }
.sset-subpop .slw-field textarea.slp-ta, .slw-field textarea.slp-ta { min-height: 96px !important; }
.slp-ta-foot { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.slp-tokens { display: flex; align-items: center; flex-wrap: wrap; gap: 5px; min-width: 0; }
.slp-tokens .slw-hint { margin-right: 2px; }
.slp-token { height: 22px; padding: 0 7px; margin: 0; font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px;
  color: rgba(200,202,220,0.85); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08);
  border-radius: 5px; cursor: pointer; }
.slp-token:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.08); }

/* Tag field: chips and the input share one control-height box. */
.slp-tagfield { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; min-height: var(--ctl-h, 30px);
  box-sizing: border-box; padding: 3px 4px; cursor: text;
  background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.08); border-radius: var(--ctl-r, 8px);
  transition: border-color 120ms ease, background-color 120ms ease; }
.slp-tagfield:focus-within { border-color: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); background: rgba(255,255,255,0.05); }
.slp-tag-chip { display: inline-flex; align-items: center; gap: 2px; max-width: 100%; height: 22px; box-sizing: border-box;
  padding: 0 2px 0 8px; font-size: 11.5px; letter-spacing: -0.005em; color: var(--t1, #eeeef5);
  background: rgba(255,255,255,0.075); border-radius: 5px; cursor: default; }
.slp-tag-chip > button { flex: 0 0 auto; width: 18px; height: 18px; padding: 0; display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 4px; background: transparent; color: rgba(160,164,184,0.75); cursor: pointer; }
.slp-tag-chip > button:hover { background: rgba(255,255,255,0.1); color: var(--t1, #eeeef5); }
.slp-chip-t { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.slp-tagfield-input { flex: 1 1 120px; min-width: 100px; height: 22px; box-sizing: border-box; padding: 0 6px; margin: 0;
  font: inherit; font-size: 11.5px; color: var(--t1, #eeeef5); background: transparent; border: none; outline: none; }
.slp-tagfield-input::placeholder { color: rgba(160,164,184,0.45); }
.slp-suggest { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.slp-suggest .slw-hint { margin-right: 2px; }
.slp-suggest-chip { height: 22px; padding: 0 8px; margin: 0; font: inherit; font-size: 11px; color: rgba(160,164,184,0.85);
  background: transparent; border: 1px dashed rgba(255,255,255,0.16); border-radius: 5px; cursor: pointer; }
.slp-suggest-chip:hover { color: var(--t1, #eeeef5); border-color: rgba(255,255,255,0.28); }

/* Delivery: collapsible sections. */
.slp-accs { display: flex; flex-direction: column; gap: 8px; }
.slp-acc { border: 1px solid rgba(255,255,255,0.065); border-radius: 10px; background: rgba(255,255,255,0.012); }
.slp-acc-head { display: flex; align-items: center; gap: 10px; width: 100%; height: 44px; padding: 0 14px; margin: 0;
  box-sizing: border-box; font: inherit; text-align: left; color: inherit; background: transparent; border: none;
  border-radius: 10px; cursor: pointer; }
@media (hover: hover) { .slp-acc-head:hover { background: rgba(255,255,255,0.025); } }
.slp-acc-head:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.slp-acc-title { flex: 0 0 auto; font-size: 12.5px; font-weight: 550; letter-spacing: -0.008em; color: var(--t1, #eeeef5); }
.slp-acc-sum { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 11px; color: rgba(160,164,184,0.6);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.slp-acc-chev { flex: 0 0 auto; color: rgba(160,164,184,0.55); transition: transform 160ms ease; }
.slp-acc[data-open="1"] .slp-acc-chev { transform: rotate(180deg); }
.slp-acc[data-open="1"] .slp-acc-head { border-radius: 10px 10px 0 0; }
.slp-acc-body { display: flex; flex-direction: column; gap: 10px; padding: 12px 14px 14px; border-top: 1px solid rgba(255,255,255,0.05); }
.slp-acc-body > .slw-hint { margin-top: -2px; }

.sl-list > .slp-item + .slp-item { border-top: 1px solid rgba(255,255,255,0.05); }
.slp-rowedit { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px 14px;
  border-top: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.015); }
.slp-rowedit-actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.slp-thumb { width: 32px; height: 32px; border-radius: 7px; object-fit: cover; display: block; box-sizing: border-box;
  border: 1px solid rgba(255,255,255,0.08); }
.slp-ico { width: 32px; height: 32px; border-radius: 7px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(200,202,220,0.8); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.07); }
.slp-tag { flex: 0 0 auto; }
.slp-tag[data-show="1"] { color: rgb(110,196,210); }
.slp-tag[data-show="0"] { color: rgb(222,168,92); }
.slp-addrow { display: flex; gap: 6px; }
.slp-addrow .sset-btn { flex: 1 1 0; min-width: 0; }
.slp-check { width: 18px; height: 18px; border-radius: 5px; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.18); }
.slp-check[data-on="1"] { background: var(--acc, #6c63ff); border-color: transparent; }
/* Accent details: icon tiles, status pills, preview card. Colour is
   used for meaning only — the accent marks things that are set up. */
.slp-head-thumb { flex: 0 0 auto; display: inline-flex; }
.slw-ed-title .sl-stat { margin-left: auto; flex: 0 0 auto; font-size: 11px; }
.slp-ico-tile { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px; box-sizing: border-box;
  display: inline-flex; align-items: center; justify-content: center;
  color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #e6e7f2);
  background: color-mix(in oklab, var(--acc, #6c63ff) 13%, rgba(255,255,255,0.02));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 26%, transparent); }
.slw-setrow .slp-ico-tile { margin-right: -2px; }
.slw-setrow:not([data-on="1"]) .slp-ico-tile { color: rgba(160,164,184,0.7); background: rgba(255,255,255,0.04);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
.slp-pill { display: inline-flex; align-items: center; gap: 5px; height: 20px; padding: 0 8px; border-radius: 10px;
  font-size: 10.5px; font-weight: 500; color: rgba(160,164,184,0.75); background: rgba(255,255,255,0.045);
  white-space: nowrap; font-variant-numeric: tabular-nums; }
.slp-pill i { width: 5px; height: 5px; border-radius: 50%; background: rgba(160,164,184,0.5); flex: 0 0 auto; }
.slp-pill[data-on="1"] { color: rgb(120,204,160); background: rgba(88,190,140,0.1); }
.slp-pill[data-on="1"] i { background: rgb(88,190,140); }
.slp-acc-sum { display: flex; justify-content: flex-end; }
.slp-tag-chip { padding-left: 7px; gap: 4px; }
.slp-tag-check { flex: 0 0 auto; color: rgb(110,200,150); }
.slp-preview { display: flex; align-items: center; gap: 12px; padding: 12px 14px; box-sizing: border-box;
  border-radius: 10px; border: 1px solid rgba(255,255,255,0.07);
  background: linear-gradient(180deg, rgba(255,255,255,0.04), rgba(255,255,255,0.015)); }
.slp-preview-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.slp-preview-name { font-size: 13px; font-weight: 600; letter-spacing: -0.01em; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slp-preview-meta { display: flex; align-items: center; gap: 6px; font-size: 11px; color: rgba(160,164,184,0.65); white-space: nowrap; overflow: hidden; }
.slp-preview-price { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; }
.slp-preview-price strong { font-size: 17px; font-weight: 650; letter-spacing: -0.02em; color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums; }
.slp-preview-price small { font-size: 10.5px; color: rgba(160,164,184,0.6); }
.slp-value { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 9px 12px;
  border-radius: 8px; font-size: 11.5px; color: rgba(200,202,220,0.8); background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); }
.slp-value strong { color: var(--t1, #eeeef5); font-weight: 600; font-variant-numeric: tabular-nums; }
/* ── Setup wizards (new product / package / add-on, new agent) ─────
   One question per screen. The window sizes itself to the step: no
   fixed height while a wizard is up, so a short step is a short window
   and a long one grows (up to the viewport) and scrolls. Layout follows
   the platform setup assistants: centred glyph, title and one line of
   explanation, then inset grouped lists; Back, page dots and the main
   action along the bottom. */
.sset-subpop[data-fit="1"] { height: auto !important; min-height: 0 !important;
  max-height: min(780px, calc(100vh - 64px)); }
.sset-subpop[data-fit="1"] .sset-pop-resize { display: none; }
.sset-subpop[data-fit="1"] .sset-subpop-body,
.sset-subpop[data-fit="1"] .sset-subpop-body > *,
.sset-subpop[data-fit="1"] .sset-pop-page,
.sset-subpop[data-fit="1"] .sset-embed,
.sset-subpop[data-fit="1"] .sset-embed > * { flex: 0 1 auto !important; min-height: 0 !important; }

.wz { display: flex; flex-direction: column; flex: 0 1 auto; min-height: 0; }
.wz-view { flex: 0 1 auto; min-height: 0; overflow-x: hidden; overflow-y: auto;
  scrollbar-gutter: stable both-edges; scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
.wz-view::-webkit-scrollbar { width: 6px; }
.wz-view::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
.wz-view[data-anim="1"] { transition: height 380ms cubic-bezier(0.32,0.72,0,1); }
.wz-view[data-settling="1"] { overflow-y: hidden; }
.wz-inner { display: flow-root; padding: 24px 18px 20px; }
.wz-stage { display: flex; flex-direction: column; gap: 20px; }
.wz-stage[data-dir="f"] { animation: wz-in-f 400ms cubic-bezier(0.32,0.72,0,1) both; }
.wz-stage[data-dir="b"] { animation: wz-in-b 400ms cubic-bezier(0.32,0.72,0,1) both; }
@keyframes wz-in-f { from { opacity: 0; transform: translateX(24px); } to { opacity: 1; transform: none; } }
@keyframes wz-in-b { from { opacity: 0; transform: translateX(-24px); } to { opacity: 1; transform: none; } }

.wz-head { display: flex; flex-direction: column; align-items: center; text-align: center; }
/* Step icon: a quiet tinted tile, not a lit button. */
.wz-glyph { width: 40px; height: 40px; border-radius: 11px; margin-bottom: 12px; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center;
  color: color-mix(in oklab, var(--acc, #6c63ff) 50%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 15%, rgba(255,255,255,0.025));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 38%, transparent); }
.wz-title { margin: 0; font-size: 16.5px; font-weight: 650; line-height: 1.25; letter-spacing: -0.018em;
  color: var(--t1, #eeeef5); text-wrap: balance; }
.wz-sub { margin: 5px auto 0; max-width: 40ch; font-size: 12px; line-height: 1.45;
  color: rgba(166,170,192,0.72); text-wrap: pretty; }

.wz-body { display: flex; flex-direction: column; gap: 20px; }
.wz-sec { display: flex; flex-direction: column; gap: 7px; min-width: 0; }
.wz-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 4px;
  font-size: 11.5px; font-weight: 500; color: rgba(172,176,198,0.72); letter-spacing: -0.003em; }
.wz-cap small { font-size: 11px; font-weight: 400; color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }
.wz-note { padding: 0 4px; font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.62); }
.wz-group { position: relative; border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.045);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); transition: box-shadow 160ms ease; }
.wz-group[data-field="1"]:focus-within { box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07),
  0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

.wz-row { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 44px;
  padding: 0 14px; margin: 0; box-sizing: border-box; font: inherit; color: inherit; text-align: left;
  background: transparent; border: none; }
.wz-row + .wz-row::before { content: ""; position: absolute; top: 0; left: 14px; right: 0; height: 1px;
  background: rgba(255,255,255,0.065); pointer-events: none; }
.wz-row[data-ico] + .wz-row[data-ico]::before { left: 52px; }
button.wz-row, .wz-row[role="switch"], .wz-row[role="radio"] { cursor: pointer; transition: background-color 120ms ease; }
@media (hover: hover) {
  button.wz-row:hover, .wz-row[role="switch"]:hover, .wz-row[role="radio"]:hover { background: rgba(255,255,255,0.03); } }
button.wz-row:active, .wz-row[role="switch"]:active, .wz-row[role="radio"]:active { background: rgba(255,255,255,0.06); }
.wz-row:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-row[aria-disabled="true"] { opacity: 0.4; cursor: default; }
.wz-row-label { flex: 0 0 92px; font-size: 12.5px; font-weight: 500; color: var(--t1, #eeeef5); letter-spacing: -0.008em; }
.wz-row-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; padding: 9px 0; }
.wz-row-title { font-size: 12.5px; font-weight: 500; color: var(--t1, #eeeef5); letter-spacing: -0.008em; }
.wz-row-hint { font-size: 11px; line-height: 1.38; color: rgba(160,164,184,0.66); }
.wz-row-val { flex: 0 1 auto; min-width: 0; margin-left: auto; font-size: 12.5px; color: rgba(172,176,198,0.78);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.wz-row-val[data-dim="1"] { color: rgba(160,164,184,0.45); }
.wz-row-chev { flex: 0 0 auto; color: rgba(160,164,184,0.45); margin-right: -3px; }
.wz-ico { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.09); transition: background-color 160ms ease, color 160ms ease; }
.wz-row[data-on="1"] .wz-ico, .wz-row[aria-checked="true"] .wz-ico { color: #fff; background: var(--acc, #6c63ff); }
.wz-tick { flex: 0 0 auto; margin-left: auto; color: color-mix(in oklab, var(--acc, #6c63ff) 70%, #ffffff); opacity: 0;
  transform: scale(0.6); transition: opacity 160ms ease, transform 220ms cubic-bezier(0.32,0.72,0,1); }
.wz-row[aria-checked="true"] .wz-tick { opacity: 1; transform: none; }
.wz-row .bc-switch { margin-left: auto; flex: 0 0 auto; }

:is(.wz, .wd) .wz-input { flex: 1 1 auto; min-width: 0; height: 44px; padding: 0; margin: 0; border: none; outline: none; box-shadow: none;
  background: transparent; font: inherit; font-size: 13px; color: var(--t1, #eeeef5); letter-spacing: -0.008em; }
:is(.wz, .wd) .wz-input::placeholder { color: rgba(160,164,184,0.42); }
:is(.wz, .wd) .wz-input[data-align="end"] { text-align: right; }
:is(.wz, .wd) .wz-input[type="date"] { color-scheme: dark; text-align: right; }
.sset-subpop .wz textarea.wz-textarea, .wz textarea.wz-textarea { display: block; width: 100%; box-sizing: border-box; margin: 0;
  min-height: 132px !important; height: auto !important; padding: 12px 14px !important; resize: vertical;
  border: none !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; outline: none;
  font: inherit; font-size: 12.5px !important; line-height: 1.55 !important; color: var(--t1, #eeeef5); }

/* Pop-up list value: the native menu sits over the whole row. */
.wz-select { margin-left: auto; min-width: 0; display: inline-flex; align-items: center; gap: 5px;
  font-size: 12.5px; color: rgba(186,190,212,0.85); }
.wz-select > span { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-select svg { flex: 0 0 auto; color: rgba(160,164,184,0.6); }
.wz-select select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; color-scheme: dark; font-size: 13px; }

.wz-seg { display: flex; gap: 2px; padding: 2px; border-radius: 9px; background: rgba(255,255,255,0.065); }
.wz-seg button { flex: 1 1 0; min-width: 0; height: 28px; padding: 0 6px; margin: 0; border: none; border-radius: 7px;
  background: transparent; font: inherit; font-size: 12px; font-weight: 500; color: rgba(186,190,212,0.78);
  cursor: pointer; white-space: nowrap; transition: background-color 180ms ease, color 180ms ease, box-shadow 180ms ease; }
.wz-seg button[aria-checked="true"] { color: var(--t1, #eeeef5); font-weight: 600; background: rgba(255,255,255,0.15);
  box-shadow: 0 1px 3px rgba(0,0,0,0.35), inset 0 0.5px 0 rgba(255,255,255,0.14); }
.wz-seg button:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }

.wz-chips { display: flex; flex-wrap: wrap; gap: 6px; }
.wz-chips button { height: 30px; padding: 0 14px; margin: 0; border: none; border-radius: 15px; font: inherit; font-size: 12px; font-weight: 500;
  color: rgba(200,203,222,0.85); background: rgba(255,255,255,0.065); cursor: pointer;
  transition: background-color 160ms ease, color 160ms ease; }
@media (hover: hover) { .wz-chips button:hover { background: rgba(255,255,255,0.1); } }
.wz-chips button[aria-checked="true"] { color: #fff; background: var(--acc, #6c63ff); }
.wz-chips button:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }

/* Price: the amount is the one big thing on its screen. */
.wz-amount { display: flex; align-items: baseline; justify-content: center; gap: 3px; padding: 18px 14px 12px; cursor: text; }
.wz-amount-sym { font-size: 24px; font-weight: 600; color: rgba(172,176,198,0.6); letter-spacing: -0.02em; }
.wz .wz-amount input { min-width: 2ch; max-width: 100%; padding: 0; margin: 0; border: none; outline: none; background: transparent;
  font: inherit; font-size: 36px; font-weight: 700; letter-spacing: -0.035em; color: var(--t1, #eeeef5);
  font-variant-numeric: tabular-nums; text-align: center; }
.wz .wz-amount input::placeholder { color: rgba(160,164,184,0.3); }
.wz-amount-seg { padding: 0 12px 12px; }

/* Image well (basics step): click to browse, or drop a file on it. */
.wz-well-wrap { display: flex; flex-direction: column; align-items: center; margin-bottom: 12px; }
.wz-well { position: relative; width: 60px; height: 60px; padding: 0; margin: 0; border: none; border-radius: 15px; overflow: hidden;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: rgba(172,176,198,0.7);
  background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.1); transition: box-shadow 160ms ease, background-color 160ms ease; }
@media (hover: hover) { .wz-well:hover { background: rgba(255,255,255,0.09); } }
.wz-well[data-drag="1"] { box-shadow: 0 0 0 2px var(--acc, #6c63ff); }
.wz-well:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 70%, transparent); }
.wz-well img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wz-well-busy { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; background: rgba(10,11,20,0.55);
  font-size: 10.5px; font-weight: 600; color: #fff; }
.wz-well-acts { display: flex; align-items: center; justify-content: center; gap: 14px; margin-top: 7px; min-height: 16px; }
.wz-link { appearance: none; padding: 0; margin: 0; border: none; background: none; font: inherit; font-size: 12px; font-weight: 500;
  color: color-mix(in oklab, var(--acc, #6c63ff) 55%, #ffffff); cursor: pointer; }
.wz-link:hover { text-decoration: underline; text-underline-offset: 3px; }
.wz-link[data-tone="danger"] { color: rgb(240,130,124); }
.wz-link:focus-visible { outline: none; text-decoration: underline; }
.wz-err { font-size: 11.5px; color: rgb(240,140,134); }

/* Summary card (review steps). */
.wz-card { display: flex; align-items: center; gap: 12px; padding: 14px; border-radius: 14px;
  background: linear-gradient(180deg, rgba(255,255,255,0.075), rgba(255,255,255,0.035)); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.09); }
.wz-card-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wz-card-name { font-size: 14px; font-weight: 650; letter-spacing: -0.015em; color: var(--t1, #eeeef5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-card-meta { font-size: 11.5px; color: rgba(160,164,184,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-card-price { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; }
.wz-card-price strong { font-size: 18px; font-weight: 700; letter-spacing: -0.025em; color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums; }
.wz-card-price small { font-size: 10.5px; color: rgba(160,164,184,0.6); }
.wz-avatar { flex: 0 0 auto; width: 44px; height: 44px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  font-size: 17px; font-weight: 650; color: #fff; letter-spacing: -0.01em;
  background: linear-gradient(160deg, color-mix(in oklab, var(--acc, #6c63ff) 70%, #ffffff), color-mix(in oklab, var(--acc, #6c63ff) 85%, #000000));
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.25); }

/* Footer: Back · page dots · main action. */
.wz-foot { flex-shrink: 0; display: grid; grid-template-columns: minmax(0,1fr) auto minmax(0,1fr); align-items: center; gap: 10px;
  padding: 12px 16px 14px; border-top: 1px solid rgba(255,255,255,0.05); }
.wz-foot > :first-child { justify-self: start; }
.wz-foot > :last-child { justify-self: end; }
.wz-btn { appearance: none; height: 32px; padding: 0 16px; margin: 0; border: none; border-radius: 16px; font: inherit;
  font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; cursor: pointer;
  transition: background-color 140ms ease, opacity 160ms ease, transform 120ms ease; }
.wz-btn[data-kind="primary"] { min-width: 100px; color: #fff; background: var(--acc, #6c63ff);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.2), 0 1px 2px rgba(0,0,0,0.35); }
@media (hover: hover) { .wz-btn[data-kind="primary"]:hover:not([aria-disabled="true"]) { background: color-mix(in oklab, var(--acc, #6c63ff) 86%, #ffffff); } }
.wz-btn[data-kind="tinted"] { min-width: 100px; color: var(--t1, #eeeef5); background: rgba(255,255,255,0.085); }
@media (hover: hover) { .wz-btn[data-kind="tinted"]:hover { background: rgba(255,255,255,0.12); } }
.wz-btn[data-kind="plain"] { padding: 0 10px; margin-left: -6px; color: rgba(190,194,214,0.85); background: transparent; }
@media (hover: hover) { .wz-btn[data-kind="plain"]:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.05); } }
.wz-btn[aria-disabled="true"] { opacity: 0.38; cursor: default; }
.wz-btn:active:not([aria-disabled="true"]) { transform: scale(0.97); }
.wz-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-dots { display: flex; align-items: center; gap: 6px; height: 20px; }
.wz-dot { position: relative; width: 6px; height: 6px; padding: 0; margin: 0; border: none; border-radius: 3px; cursor: pointer;
  background: rgba(255,255,255,0.16); transition: width 340ms cubic-bezier(0.32,0.72,0,1), background-color 200ms ease; }
.wz-dot::after { content: ""; position: absolute; inset: -7px -3px; }
.wz-dot[data-s="done"] { background: rgba(255,255,255,0.42); }
.wz-dot[data-s="cur"] { width: 18px; background: var(--acc, #6c63ff); }
.wz-dot:disabled { cursor: default; }
.wz-dot:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-need { font-size: 11.5px; font-weight: 500; color: rgb(236,190,120); white-space: nowrap; animation: wz-fade 180ms ease both; }
@keyframes wz-fade { from { opacity: 0; } to { opacity: 1; } }
/* Captions and notes line up with what they label: inset to the row
   text above or below a grouped list, near-flush over free controls. */
.wz-cap:has(+ .wz-group), .wz-group + .wz-note { padding-left: 14px; padding-right: 14px; }
.wz-select[data-align="start"] { margin-left: 0; flex: 1 1 auto; justify-content: space-between; color: var(--t1, #eeeef5); font-size: 13px; }
.wz-select[data-align="start"] > .wz-select-val { flex: 1 1 auto; text-align: left; }
.wz-select > .wz-row-note { flex: 0 0 auto; margin-right: 2px; }
.wz-row-note { font-size: 11px; color: rgba(160,164,184,0.6); white-space: nowrap; }
/* Stock components placed inside a wizard step. */
.wz .slw-field { gap: 7px; }
@media (max-width: 440px) { .wz-row-label { flex-basis: 78px; } .wz-inner { padding: 24px 12px 20px; } }
@media (prefers-reduced-motion: reduce) {
  .wz-stage[data-dir] { animation: none; }
  .wz-view[data-anim="1"] { transition: none; }
  .wz-dot, .wz-tick, .wz-btn { transition: none; }
}
/* ── Wallet detail (Store → Payments → a wallet) ─────────────────
   The coin and its live balance on a card tinted with the coin's own
   colour, then the payout address, settings and recent transactions as
   grouped lists (same parts as the setup wizards). */
.wd-scroll { padding-top: 14px !important; }
.wd-body { display: flex; flex-direction: column; gap: 18px; padding-bottom: 6px; }
.wd-mono { font-family: var(--mono, ui-monospace, SFMono-Regular, Menlo, monospace) !important; letter-spacing: 0.01em; }
.wd-card { position: relative; overflow: hidden; border-radius: 14px;
  background:
    radial-gradient(90% 160% at 0% 0%, color-mix(in oklab, var(--wd-tint, #6c63ff) 16%, transparent) 0%, transparent 60%),
    linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0.028));
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.08); }
.wd-card-top { display: flex; align-items: center; gap: 11px; padding: 13px 14px 12px; }
.wd-card-id { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wd-card-name { font-size: 13.5px; font-weight: 650; letter-spacing: -0.012em; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wd-card-sub { display: flex; align-items: center; gap: 7px; min-width: 0; }
.wd-card-net { font-size: 11px; color: rgba(172,176,198,0.72); white-space: nowrap; }
.wd-status { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; height: 18px; padding: 0 7px; margin: 0;
  border: none; border-radius: 9px; font: inherit; font-size: 10.5px; font-weight: 600; cursor: pointer;
  color: rgba(190,194,214,0.85); background: rgba(255,255,255,0.08); transition: background-color 160ms ease, color 160ms ease; }
.wd-status i { width: 5px; height: 5px; border-radius: 50%; background: rgba(190,194,214,0.6); }
.wd-status[data-on="1"] { color: rgb(120,214,160); background: rgba(80,200,130,0.13); }
.wd-status[data-on="1"] i { background: rgb(80,210,140); }
.wd-status:hover { filter: brightness(1.12); }
.wd-status:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wd-bal { flex: 0 0 auto; max-width: 52%; display: flex; flex-direction: column; align-items: flex-end; gap: 1px; text-align: right; }
.wd-bal-label { font-size: 10.5px; color: rgba(160,164,184,0.62); }
.wd-bal-num { max-width: 100%; font-size: 19px; font-weight: 700; letter-spacing: -0.025em; line-height: 1.2; color: var(--t1, #eeeef5);
  font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wd-bal-num small { margin-left: 4px; font-size: 11.5px; font-weight: 600; letter-spacing: 0; color: rgba(172,176,198,0.7); }
.wd-bal-fiat { font-size: 11px; color: rgba(172,176,198,0.7); font-variant-numeric: tabular-nums; }
.wd-bal-na { font-size: 12px; font-weight: 500; color: rgba(172,176,198,0.55); }
.wd-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); border-top: 1px solid rgba(255,255,255,0.06);
  background: rgba(0,0,0,0.1); }
.wd-stats > span { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: 8px 14px 9px; }
.wd-stats > span + span { border-left: 1px solid rgba(255,255,255,0.06); }
.wd-stats small { font-size: 10.5px; color: rgba(160,164,184,0.65); white-space: nowrap; }
.wd-stats strong { font-size: 12px; font-weight: 600; color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.wd-addr-row { display: flex; align-items: center; gap: 10px; min-height: 48px; padding: 7px 8px 7px 14px; box-sizing: border-box; }
.wd-addr-val { flex: 1 1 auto; min-width: 0; font-size: 12px; line-height: 1.45; color: var(--t1, #eeeef5); word-break: break-all; user-select: all; }
.wd-addr-val em { font-style: normal; font-family: var(--font); color: rgba(160,164,184,0.5); }
.wd-addr-in { height: 34px !important; font-size: 12px !important; }
.wd-addr-icons { flex: 0 0 auto; display: flex; align-items: center; gap: 2px; }
.wd-ibtn { width: 28px; height: 28px; padding: 0; margin: 0; border: none; border-radius: 7px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(172,176,198,0.75); cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.wd-ibtn:hover:not(:disabled) { background: rgba(255,255,255,0.07); color: var(--t1, #eeeef5); }
.wd-ibtn:disabled { opacity: 0.35; cursor: default; }
.wd-ibtn[data-done="1"] { color: rgb(110,210,150); }
.wd-ibtn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-note[data-warn="1"] { color: rgb(236,190,120); }

.wd-refresh { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; margin: -4px -4px -4px 0;
  border: none; border-radius: 11px; background: transparent; color: rgba(172,176,198,0.7); cursor: pointer; }
.wd-refresh:hover { background: rgba(255,255,255,0.07); color: var(--t1, #eeeef5); }
.wd-refresh[data-spin="1"] svg { animation: wd-spin 900ms linear infinite; }
@keyframes wd-spin { to { transform: rotate(360deg); } }

.wd-tx { position: relative; display: flex; align-items: center; gap: 12px; width: 100%; min-height: 56px; padding: 0 14px; margin: 0;
  box-sizing: border-box; border: none; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer;
  transition: background-color 120ms ease; }
.wd-tx + .wd-tx::before, .wd-empty + .wd-tx::before { content: ""; position: absolute; top: 0; left: 56px; right: 0; height: 1px; background: rgba(255,255,255,0.065); }
@media (hover: hover) { .wd-tx:hover:not(:disabled):not([data-skel]) { background: rgba(255,255,255,0.03); } }
.wd-tx:disabled, .wd-tx[data-skel] { cursor: default; }
.wd-tx:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wd-tx-ico { flex: 0 0 auto; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(214,216,232,0.85); background: rgba(255,255,255,0.08); }
.wd-tx[data-k="in"] .wd-tx-ico { color: rgb(110,214,156); background: rgba(80,200,130,0.14); }
.wd-tx[data-k="pending"] .wd-tx-ico { color: rgb(236,190,120); background: rgba(222,168,92,0.14); }
.wd-tx[data-k="failed"] .wd-tx-ico { color: rgb(240,130,124); background: rgba(230,110,104,0.13); }
.wd-tx-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.wd-tx-title { display: flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 550; color: var(--t1, #eeeef5);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; letter-spacing: -0.006em; }
.wd-tx-tag { flex: 0 0 auto; height: 16px; padding: 0 6px; border-radius: 8px; display: inline-flex; align-items: center;
  font-size: 9.5px; font-weight: 600; color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 18%, transparent); }
.wd-tx-sub { font-size: 11px; color: rgba(160,164,184,0.62); white-space: pre; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.wd-tx-val { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 3px; max-width: 48%; }
.wd-tx-amt { font-size: 12.5px; font-weight: 600; color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
.wd-tx[data-k="in"] .wd-tx-amt { color: rgb(120,214,160); }
.wd-tx[data-k="failed"] .wd-tx-amt { color: rgba(160,164,184,0.55); text-decoration: line-through; }
.wd-tx-fiat { font-size: 11px; color: rgba(160,164,184,0.62); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wd-tx[data-k="pending"] .wd-tx-fiat { color: rgb(236,190,120); }
.wd-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 22px 18px; text-align: center;
  font-size: 11.5px; line-height: 1.45; color: rgba(160,164,184,0.66); }
.wd-empty strong { font-size: 12.5px; font-weight: 600; color: var(--t2, #c8c9d8); }
.wd-empty .wz-link { margin-top: 6px; }
.wd-empty[data-compact="1"] { padding: 14px 18px; }
.wd-foot-note { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
/* Inline "Saved" beside a Save button — the in-place twin of the status
   pill (bcToast): accent check in a soft accent disc, quiet text. */
.wd-saved { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 500; color: var(--t2, #9898b4);
  margin-right: 6px; white-space: nowrap; animation: wz-fade 180ms ease both; }
.wd-saved::before { content: ""; width: 16px; height: 16px; border-radius: 50%; flex: 0 0 auto;
  background: var(--acc, #6c63ff);
  -webkit-mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23000' fill-opacity='.2'/%3E%3Cpolyline points='17 8.5 10.5 15.5 7 12' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat;
          mask: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Ccircle cx='12' cy='12' r='12' fill='%23000' fill-opacity='.2'/%3E%3Cpolyline points='17 8.5 10.5 15.5 7 12' fill='none' stroke='%23000' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 100% 100% no-repeat; }
.wd-skel { display: block; height: 10px; border-radius: 5px; background: linear-gradient(90deg, rgba(255,255,255,0.05), rgba(255,255,255,0.1), rgba(255,255,255,0.05));
  background-size: 200% 100%; animation: wd-shimmer 1.3s ease-in-out infinite; }
.wd-skel-ico { width: 30px; height: 30px; border-radius: 50%; flex: 0 0 auto; }
.wd-skel-bal { width: 90px; height: 20px; border-radius: 6px; margin: 2px 0; }
@keyframes wd-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }

/* License detail and verification API reuse the wallet page parts. */
.wd-avatar { flex: 0 0 auto; width: 34px; height: 34px; border-radius: 50%; object-fit: cover; display: inline-flex; align-items: center; justify-content: center;
  font-size: 13px; font-weight: 650; color: var(--t1, #eeeef5); background: rgba(255,255,255,0.09); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.12); }
.wd-exp { flex: 0 0 auto; display: flex; flex-direction: column; align-items: flex-end; gap: 2px; text-align: right; }
.wd-exp-big { font-size: 15px; font-weight: 650; letter-spacing: -0.015em; color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums; white-space: nowrap; }
.wd-exp-sub { font-size: 11px; color: rgba(160,164,184,0.65); white-space: nowrap; }
.wd-lic-pill { display: inline-flex; align-items: center; gap: 5px; height: 18px; padding: 0 7px; border-radius: 9px; font-size: 10.5px; font-weight: 600;
  color: rgba(190,194,214,0.85); background: rgba(255,255,255,0.08); white-space: nowrap; }
.wd-lic-pill i { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.wd-lic-pill[data-s="active"] { color: rgb(120,214,160); background: rgba(80,200,130,0.13); }
.wd-lic-pill[data-s="expiring"], .wd-lic-pill[data-s="suspended"] { color: rgb(236,190,120); background: rgba(222,168,92,0.13); }
.wd-lic-pill[data-s="expired"] { color: rgb(240,140,134); background: rgba(230,110,104,0.13); }
.wd-kv-val { flex: 1 1 auto; min-width: 0; text-align: right; font-size: 12.5px; color: rgba(200,203,222,0.9);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.wd-kv-val small { color: rgba(160,164,184,0.6); font-size: 11.5px; }
.wd-kv-val.wd-mono { font-size: 11.5px; }
.wz-row .wd-ibtn { margin-right: -6px; }
.wz-row .wd-ibtn + .wd-ibtn { margin-left: -8px; }
.wd-quick { display: flex; gap: 6px; padding: 0 14px 12px; }
.wd-quick button { height: 26px; padding: 0 11px; margin: 0; border: none; border-radius: 13px; font: inherit; font-size: 11.5px; font-weight: 500;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.07); cursor: pointer; transition: background-color 140ms ease; }
.wd-quick button:hover { background: rgba(255,255,255,0.12); }
.wd-quick button:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
/* Invoice popup — why the invoice exists. One quiet line in the agent's
   words, then small neutral tags for the facts (renewal, one key /
   separate keys, replaced). Same surface as every other group. */
.inv-purpose { padding: 11px 14px 12px; display: flex; flex-direction: column; gap: 8px; }
.inv-purpose-text { margin: 0; font-size: 12.5px; line-height: 1.5; color: rgba(214,216,232,0.92); letter-spacing: -0.003em; }
.inv-purpose-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.inv-tag { display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; font-size: 10.5px; font-weight: 550;
  color: rgba(190,194,214,0.88); background: rgba(255,255,255,0.06); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); white-space: nowrap; }
.sset-subpop .wd textarea.wz-textarea, .wd textarea.wz-textarea { display: block; width: 100%; box-sizing: border-box; margin: 0;
  min-height: 72px !important; height: auto !important; padding: 11px 14px !important; resize: vertical;
  border: none !important; border-radius: 0 !important; background: transparent !important; box-shadow: none !important; outline: none;
  font: inherit; font-size: 12.5px !important; line-height: 1.5 !important; color: var(--t1, #eeeef5); }
.wd .wz-group[data-field="1"]:focus-within { box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07),
  0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
button.wz-row > svg:last-child { flex: 0 0 auto; margin-left: auto; color: rgba(160,164,184,0.55); }
.wd-err { padding: 9px 12px; border-radius: 10px; font-size: 11.5px; color: rgb(240,150,144); background: rgba(230,110,104,0.09); }
.wd-api { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 16px var(--gutter, 18px) 18px; display: flex; flex-direction: column; gap: 18px; }
/* New wallet wizard: currency tiles and the coin as the step's icon. */
.wz-coinhero { display: inline-flex; margin-bottom: 12px; border-radius: 50%; box-shadow: 0 0 0 3px rgba(255,255,255,0.04); }
.wz-coins { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px; }
.wz-coin { position: relative; display: flex; align-items: center; gap: 9px; min-width: 0; height: 44px; padding: 0 10px; margin: 0;
  border: none; border-radius: 10px; font: inherit; color: inherit; text-align: left; cursor: pointer; background: rgba(255,255,255,0.04);
  box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); transition: background-color 140ms ease, box-shadow 160ms ease; }
@media (hover: hover) { .wz-coin:hover:not(:disabled) { background: rgba(255,255,255,0.075); } }
.wz-coin > :first-child { flex: 0 0 auto; }
.wz-coin[aria-checked="true"] { background: color-mix(in oklab, var(--acc, #6c63ff) 12%, rgba(255,255,255,0.03));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 75%, #ffffff); }
.wz-coin:disabled { opacity: 0.35; cursor: default; }
.wz-coin:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-coin-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wz-coin-name { font-size: 12px; font-weight: 600; color: var(--t1, #eeeef5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-coin-net { font-size: 10.5px; color: rgba(160,164,184,0.62); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-coin-other { width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(190,194,214,0.8); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.22); }
.sset-subpop .wz textarea.wz-textarea.wd-addr-input, .wz textarea.wz-textarea.wd-addr-input {
  min-height: 62px !important; resize: none; font-size: 12.5px !important; word-break: break-all; }
@media (max-width: 440px) { .wz-coins { grid-template-columns: repeat(2, minmax(0, 1fr)); } .wd-bal-num { font-size: 17px; } }
@media (prefers-reduced-motion: reduce) { .wd-skel, .wd-refresh[data-spin="1"] svg { animation: none; } }
/* ── Connections page: one list per topic, rows open in place ───── */
.sset-subpop .sset-pop-body.cx { gap: 18px; padding-top: 14px; }
.cx-sec { display: flex; flex-direction: column; gap: 7px; }
.cx-cap { padding: 0 14px; font-size: 11.5px; font-weight: 500; color: rgba(172,176,198,0.72); letter-spacing: -0.003em; }
.cx-list { border-radius: 12px; overflow: hidden; background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
.cx-card + .cx-card { border-top: 1px solid rgba(255,255,255,0.06); }
.cx-head { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 54px; padding: 9px 14px; margin: 0; box-sizing: border-box;
  border: none; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
@media (hover: hover) { .cx-head:hover { background: rgba(255,255,255,0.025); } }
.cx-head:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.cx-ico { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.07); }
.cx-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cx-title { font-size: 12.5px; font-weight: 550; color: var(--t1, #eeeef5); letter-spacing: -0.008em; }
.cx-sum { font-size: 11px; color: rgba(160,164,184,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cx-dot { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; background: rgba(255,255,255,0.18); }
.cx-dot[data-s="on"] { background: rgb(80,210,140); box-shadow: 0 0 0 3px rgba(80,210,140,0.15); }
.cx-dot[data-s="warn"] { background: rgb(232,176,92); box-shadow: 0 0 0 3px rgba(232,176,92,0.15); }
.cx-dot[data-s="idle"] { background: rgba(190,194,214,0.45); }
.cx-chev { flex: 0 0 auto; color: rgba(160,164,184,0.5); transition: transform 180ms ease; }
.cx-card[data-open="1"] .cx-chev { transform: rotate(180deg); }
.cx-body { padding: 2px 14px 14px; animation: wz-fade 160ms ease both; }
.cx-inner { display: flex; flex-direction: column; gap: 12px; }
.cx-inner > .sset-pop-section:first-child { margin-top: 0; }
.cx-body .sset-disclose { border-top: 1px solid rgba(255,255,255,0.05); }
/* Sentence-case labels inside the rows, like the rest of the page. */
.sset-subpop .cx-body .sset-pop-section-label, .sset-subpop .cx-body .sset-disclose-head span,
.sset-subpop .cx-body .sset-field-label { text-transform: none !important; letter-spacing: 0 !important; font-size: 11.5px !important;
  font-weight: 500 !important; color: rgba(172,176,198,0.75) !important; }
.sset-subpop .sset-pop-body.cx > .bc-card { border: none; border-radius: 12px; padding: 12px 14px !important;
  background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
@media (prefers-reduced-motion: reduce) { .cx-chev { transition: none; } .cx-body { animation: none; } }
/* Checkout switch rows: a touch tighter inside the editor. */
.slp-body .slw-setrow { min-height: 52px; }
@media (prefers-reduced-motion: reduce) { .slp-acc-chev, .slp-tagfield { transition: none; } }
@media (max-width: 460px) { .slp-grid-price { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } }

/* ── Detail pages (License, Invoice) ───────────────────────────────
   Same frame as the wallet editor: a toolbar with back + title + status,
   a scrolling body of titled groups, and a footer of actions. Facts are
   shown as label / value rows inside one bordered group. */
.slw-ed-title { flex: 1 1 auto; }
.slw-ed-title .sl-stat { margin-left: auto; font-size: 11.5px; }
.slw-sub { display: block; font-size: 11px; font-weight: 400; color: rgba(160,164,184,0.6); margin-top: 2px;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.slw-titles { min-width: 0; display: flex; flex-direction: column; }
.slw-group { display: flex; flex-direction: column; gap: 8px; }
.slw-group-title { font-size: 11.5px; font-weight: 550; color: var(--t2, #c8c9d8); letter-spacing: -0.005em; }
.sl-kv { display: flex; align-items: center; gap: 12px; min-height: 40px; padding: 8px 14px; box-sizing: border-box;
  border-top: 1px solid rgba(255,255,255,0.05); }
.sl-kv:first-child { border-top: none; }
.sl-kv-k { flex: 0 0 128px; font-size: 11.5px; color: rgba(160,164,184,0.7); letter-spacing: -0.003em; }
.sl-kv-v { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px;
  font-size: 12px; color: var(--t1, #eeeef5); text-align: right; font-variant-numeric: tabular-nums; }
.sl-kv-v > .sl-kv-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sl-kv-v .sl-kv-dim { color: rgba(160,164,184,0.6); }
.sl-kv-v .sl-row-mono { font-size: 11px; }
.sl-kv-note { font-size: 11px; line-height: 1.45; color: rgba(160,164,184,0.65); padding: 0 14px 10px; margin-top: -4px; text-align: right; }
.sl-mini { flex: 0 0 auto; height: 22px; padding: 0 7px; display: inline-flex; align-items: center; gap: 4px;
  font: inherit; font-size: 10.5px; font-weight: 550; color: rgba(160,164,184,0.85); background: rgba(255,255,255,0.045);
  border: 1px solid rgba(255,255,255,0.07); border-radius: 5px; cursor: pointer; white-space: nowrap; }
.sl-mini:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.08); }
.sl-mini[data-done="1"] { color: rgb(88,190,140); }
.sl-alert { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; font-size: 11.5px; line-height: 1.45;
  color: rgb(236,190,120); background: rgba(222,168,92,0.08); border: 1px solid rgba(222,168,92,0.22); }
.sl-alert[data-tone="danger"] { color: rgb(240,150,144); background: rgba(230,110,104,0.08); border-color: rgba(230,110,104,0.22); }
.sl-alert svg { flex: 0 0 auto; margin-top: 1px; }
.slw-seg { display: flex; gap: 3px; padding: 3px; border-radius: 8px; background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.06); }
.slw-seg button { flex: 1 1 0; min-width: 0; height: 24px; padding: 0 6px; margin: 0; font: inherit; font-size: 11.5px; font-weight: 500;
  color: rgba(160,164,184,0.75); background: transparent; border: none; border-radius: 6px; cursor: pointer; white-space: nowrap; }
.slw-seg button:hover { color: var(--t1, #eeeef5); }
.slw-seg button[aria-checked="true"] { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.08);
  box-shadow: inset 0 0.5px 0 rgba(255,255,255,0.08), 0 1px 2px rgba(0,0,0,0.3); font-weight: 600; }
.slw-seg button:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.slw-inline { display: flex; align-items: center; gap: 6px; }
.slw-inline .slw-input { flex: 1 1 auto; min-width: 0; }
.slw-input[type="date"] { color-scheme: dark; }
/* The popup's global textarea rule is !important; match its own tokens
   but keep the same type size as the other fields on the page. */
.sset-subpop textarea.slw-input, textarea.slw-input { height: auto !important; min-height: 76px !important;
  padding: 8px var(--ctl-px, 10px) !important; font-size: 11.5px !important; line-height: 1.55 !important;
  border-radius: var(--ctl-r, 8px) !important; resize: vertical; }
@media (prefers-reduced-motion: reduce) {
  .sl-menu { animation: none; }
  .sset-hd-tab, .sset-hd-tab::after, .sl-row, .sl-act, .sl-filter, .sl-bar-add,
  .sl-search input, .slw-coin, .slw-input { transition: none; }
}`;
  document.head.appendChild(st);
};

// ── Popup controls, themed ────────────────────────────────────────
// Last word in the cascade for every control inside a settings window:
// switches, buttons, segmented pickers, steppers, fields, dropdowns and
// the wizard's chips. One quiet vocabulary built from the accent the
// person chose in Appearance (--acc): a soft accent tint marks "on" or
// "chosen", solid accent is kept for the one primary action on a screen,
// and everything else stays neutral glass. Injected after every other
// popup stylesheet, and scoped to .sset-subpop so nothing else changes.
const ensurePopupThemeStyles = () => {
  if (typeof document === 'undefined') return;
  const old = document.getElementById('sset-theme-style');
  if (old && old === document.head.lastElementChild) return;
  const st = old || document.createElement('style');
  st.id = 'sset-theme-style';
  st.textContent = `
.sset-subpop {
  --pt-acc: var(--acc, #6c63ff);
  --pt-tint: color-mix(in oklab, var(--pt-acc) 15%, transparent);
  --pt-tint-2: color-mix(in oklab, var(--pt-acc) 24%, transparent);
  --pt-line: color-mix(in oklab, var(--pt-acc) 40%, transparent);
  --pt-ink: color-mix(in oklab, var(--pt-acc) 30%, #f3f3f8);
  --pt-ring: 0 0 0 2px color-mix(in oklab, var(--pt-acc) 38%, transparent);
  --pt-field: rgba(255,255,255,0.03);
  --pt-field-line: rgba(255,255,255,0.075);
}

/* Switches — one size, one look */
.sset-subpop .bc-switch, .sset-subpop .ags-switch {
  width: 26px; height: 15px; border-radius: 999px; border: none; padding: 0;
  background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }
.sset-subpop .bc-switch::after { top: 2px; left: 2px; width: 11px; height: 11px; background: rgba(220,222,235,0.72); box-shadow: 0 1px 2px rgba(0,0,0,0.35); }
.sset-subpop .bc-switch[data-on="1"], .sset-subpop .ags-switch[data-on="1"] {
  background: color-mix(in oklab, var(--pt-acc) 82%, #1a1b2c); box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 60%, #fff 8%); }
.sset-subpop .bc-switch[data-on="1"]::after { transform: translateX(11px); background: #fff; }
.sset-subpop .ags-switch-knob { top: 2px; left: 2px; width: 11px; height: 11px; background: rgba(220,222,235,0.72); }
.sset-subpop .ags-switch[data-on="1"] .ags-switch-knob { left: 13px; background: #fff; }
.sset-subpop .bc-switch:focus-visible, .sset-subpop .ags-switch:focus-visible { outline: none; box-shadow: var(--pt-ring); }

/* Buttons */
.sset-subpop button.sg-btn, .sset-subpop .sset-btn {
  height: 30px; padding: 0 13px; border-radius: var(--ctl-r, 8px); font-size: 11.5px; font-weight: 550;
  color: rgba(214,216,232,0.9); background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); box-shadow: none; }
.sset-subpop button.sg-btn:hover, .sset-subpop .sset-btn:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); }
.sset-subpop button.sg-btn-primary, .sset-subpop .sset-btn[data-variant="primary"] {
  color: #fff; background: color-mix(in oklab, var(--pt-acc) 88%, #15162a); border-color: color-mix(in oklab, var(--pt-acc) 70%, #fff 12%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12); }
.sset-subpop button.sg-btn-primary:hover, .sset-subpop .sset-btn[data-variant="primary"]:hover {
  color: #fff; filter: none; background: color-mix(in oklab, var(--pt-acc) 96%, #fff 4%); border-color: color-mix(in oklab, var(--pt-acc) 70%, #fff 20%); }
.sset-subpop button.sg-btn-danger { color: rgb(236,128,122); background: transparent; border-color: rgba(230,110,104,0.22); }
.sset-subpop button.sg-btn-danger:hover { color: rgb(246,140,134); background: rgba(230,110,104,0.08); border-color: rgba(230,110,104,0.36); }
.sset-subpop button.sg-btn:focus-visible, .sset-subpop .sset-btn:focus-visible { outline: none; box-shadow: var(--pt-ring); }
.sset-subpop .sl-bar-add, .sset-subpop .sset-back-action {
  color: var(--pt-ink); background: var(--pt-tint); border: 1px solid var(--pt-line); }
.sset-subpop .sl-bar-add:hover, .sset-subpop .sset-back-action:hover { background: var(--pt-tint-2); border-color: color-mix(in oklab, var(--pt-acc) 55%, transparent); }
.sset-subpop .sset-ghost-btn { color: rgba(190,192,212,0.85); background: transparent; border: 1px dashed rgba(255,255,255,0.14); border-radius: 7px; }
.sset-subpop .sset-ghost-btn:hover:not(:disabled) { color: var(--pt-ink); border-color: var(--pt-line); background: var(--pt-tint); }
.sset-subpop .bc-status { border-radius: 8px; }
.sset-subpop .sl-act:hover { background: rgba(255,255,255,0.06); }

/* Segmented pickers and tab pills: the chosen one is tinted with the accent */
.sset-subpop .bc-seg, .sset-subpop .ags-seg, .sset-subpop .wz-seg, .sset-subpop .sset-pop-tabs {
  background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.06); box-shadow: none; border-radius: 9px; }
.sset-subpop .bc-seg button, .sset-subpop .ags-seg button, .sset-subpop .wz-seg button, .sset-subpop .sset-pop-tabs button {
  color: rgba(160,164,184,0.8); font-weight: 500; }
.sset-subpop .bc-seg button:hover, .sset-subpop .ags-seg button:hover, .sset-subpop .wz-seg button:hover, .sset-subpop .sset-pop-tabs button:hover {
  color: var(--t1, #eeeef5); background: rgba(255,255,255,0.035); }
.sset-subpop .bc-seg button[data-on="1"], .sset-subpop .ags-seg button[data-on="1"], .sset-subpop .wz-seg button[aria-checked="true"],
.sset-subpop .sset-pop-tabs button[aria-selected="true"] {
  color: var(--t1, #eeeef5); font-weight: 600; background: var(--pt-tint);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 34%, transparent); }
.sset-subpop .sset-pop-tabs button[aria-selected="true"] .sset-pop-tabs-count { color: var(--pt-ink); background: var(--pt-tint-2); }

/* Text filters under a search (All / Active / …) become quiet pills */
.sset-subpop .sl-filters { gap: 4px; }
.sset-subpop .sl-filter { height: 24px; padding: 0 9px; border-radius: 12px; align-items: center; }
.sset-subpop .sl-filter[aria-pressed="true"] { background: var(--pt-tint); color: var(--t1, #eeeef5);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 30%, transparent); }
.sset-subpop .sl-filter[aria-pressed="true"] span { color: var(--pt-ink); }
.sset-subpop .sl-filter:focus-visible { text-decoration: none; box-shadow: var(--pt-ring); }

/* Fields, dropdowns and steppers share one surface and one focus ring */
.sset-subpop .slw-input, .sset-subpop .sset-select, .sset-subpop .agx-num, .sset-subpop .sl-search input,
.sset-subpop .fi, .sset-subpop .sset-input, .sset-subpop .ags-time {
  background-color: var(--pt-field); border: 1px solid var(--pt-field-line); }
.sset-subpop .slw-input:focus, .sset-subpop .sset-select:focus, .sset-subpop .agx-num:focus, .sset-subpop .sl-search input:focus,
.sset-subpop .fi:focus, .sset-subpop .sset-input:focus {
  border-color: color-mix(in oklab, var(--pt-acc) 55%, transparent); background-color: rgba(255,255,255,0.045);
  box-shadow: 0 0 0 3px color-mix(in oklab, var(--pt-acc) 14%, transparent); outline: none; }
.sset-subpop .sset-select { height: var(--ctl-h, 30px); padding-top: 0; padding-bottom: 0; border-radius: var(--ctl-r, 8px); }
.sset-subpop .sset-select:hover, .sset-subpop .ags-time:hover { border-color: rgba(255,255,255,0.14); }
.sset-subpop .sset-select-wrap-icon { left: 10px; color: color-mix(in oklab, var(--pt-acc) 40%, #a8aac4); }
.sel-sym { display: inline-flex; align-items: center; justify-content: center; min-width: 13px; font-size: 12px; font-weight: 600;
  line-height: 1; color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #d8d9ea); }
.sset-subpop .ags-time { border-radius: 7px; }
.sset-subpop .ags-time[data-open="1"] { border-color: color-mix(in oklab, var(--pt-acc) 55%, transparent); }
.ags-time-ico { display: inline-flex; color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #a8aac4); }
.ags-tz-wrap { flex: 1 1 auto; min-width: 0; width: auto; }
.ags-tz-wrap .ags-tz { width: 100%; text-overflow: ellipsis; }
.wz-select > .wz-select-ico { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 16px; width: 16px; height: 16px;
  overflow: visible; color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #a8aac4); }
.wz-select > .wz-select-ico svg, .wz-select > .wz-select-ico img { display: block; color: inherit; }
.wz-select[data-align="start"] { gap: 8px; }
.wz-select > .wz-select-val { min-width: 0; }
/* Popup dropdown glyphs sit centred in the same 16px box */
.sset-subpop .sset-select-wrap-icon { width: 16px; height: 16px; align-items: center; justify-content: center; left: 9px; }
.sset-subpop .sset-select-wrap-icon svg, .sset-subpop .sset-select-wrap-icon img { display: block; }
.sset-subpop .sset-select-wrap[data-icon] .sset-select { padding-left: 32px; }
.sset-subpop .slw-step { background: var(--pt-field); border-color: var(--pt-field-line); }
.sset-subpop .slw-step button:hover:not(:disabled) { color: var(--pt-ink); background: var(--pt-tint); }

/* Reply-hours day buttons and the wizard's choice chips: tint, not paint */
.sset-subpop .ags-day { background: rgba(255,255,255,0.02); border-color: rgba(255,255,255,0.07); color: rgba(160,164,184,0.8); }
.sset-subpop .ags-day[data-on="1"] { color: var(--pt-ink); background: var(--pt-tint); border-color: var(--pt-line); }
.sset-subpop .ags-day:focus-visible, .sset-subpop .ags-seg button:focus-visible { outline: none; box-shadow: var(--pt-ring); }
.sset-subpop .ags[data-on="1"] .ags-ico { color: var(--pt-ink); background: var(--pt-tint); border-color: var(--pt-line); }
.sset-subpop .wz-chips button { background: rgba(255,255,255,0.04); color: rgba(200,202,220,0.85); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
.sset-subpop .wz-chips button[aria-checked="true"] { color: var(--t1, #eeeef5); background: var(--pt-tint);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 45%, transparent); }
.sset-subpop .wz-row[data-on="1"] .wz-ico, .sset-subpop .wz-row[aria-checked="true"] .wz-ico { color: var(--pt-ink); background: var(--pt-tint); }
.sset-subpop .wz-btn[data-kind="primary"] { background: color-mix(in oklab, var(--pt-acc) 88%, #15162a);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.12), inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 70%, #fff 10%); }
.sset-subpop .wz-btn[data-kind="tinted"] { background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.sset-subpop .wz-btn:focus-visible { outline: none; box-shadow: var(--pt-ring); }

/* Wizard sections that fold (optional extras) */
.wz-fold { appearance: none; display: flex; align-items: center; gap: 7px; width: 100%; min-width: 0; margin: 0 0 6px; padding: 9px 12px;
  font: inherit; text-align: left; color: inherit; cursor: pointer; background: rgba(255,255,255,0.02);
  border: 1px solid rgba(255,255,255,0.06); border-radius: 10px; transition: background-color 120ms ease; }
@media (hover: hover) { .wz-fold:hover { background: rgba(255,255,255,0.04); } }
.wz-fold:focus-visible { outline: none; box-shadow: var(--pt-ring, 0 0 0 2px rgba(108,99,255,0.4)); }
.wz-sec[data-fold="open"] .wz-fold { background: transparent; border-color: transparent; padding-left: 2px; padding-right: 2px; }
.wz-fold-cap { flex: 0 0 auto; font-size: 12px; font-weight: 600; color: var(--t1, #eeeef5); letter-spacing: -0.006em; }
.wz-fold-sum { margin-left: auto; min-width: 0; font-size: 11px; color: rgba(160,164,184,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Generic fold used inside editors (e.g. product pricing extras) */
.bc-fold { display: flex; flex-direction: column; gap: 10px; }
.bc-fold[data-fold="shut"] > .agx-fold { padding: 9px 12px; border: 1px solid rgba(255,255,255,0.055); border-radius: 10px; background: rgba(255,255,255,0.01); }

/* Older checkbox switches match .bc-switch */
.sset-subpop .sset-tgl { width: 26px; height: 15px; }
.sset-subpop .sset-tgl-sl { background: rgba(255,255,255,0.1); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.05); }
.sset-subpop .sset-tgl-sl::before { width: 11px; height: 11px; left: 2px; bottom: 2px; background: rgba(220,222,235,0.72); }
.sset-subpop .sset-tgl input:checked + .sset-tgl-sl { background: color-mix(in oklab, var(--pt-acc) 82%, #1a1b2c);
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--pt-acc) 60%, #fff 8%); }
.sset-subpop .sset-tgl input:checked + .sset-tgl-sl::before { transform: translateX(11px); background: #fff; }
.sset-subpop .sset-tgl input:focus-visible + .sset-tgl-sl { box-shadow: var(--pt-ring); }
/* Folding sections on Preferences pages */
.sset-pop-section[data-fold] > .sset-fold { margin-bottom: 8px; }
.sset-pop-section[data-fold="shut"] > .sset-fold { margin-bottom: 0; padding: 9px 12px; border: 1px solid rgba(255,255,255,0.055);
  border-radius: 10px; background: rgba(255,255,255,0.01); }
.sset-pop-section[data-fold="shut"] { border-top: none !important; }

/* Tab glyphs */
.tab-ico { flex: 0 0 auto; opacity: 0.7; transition: opacity 120ms ease, color 120ms ease; }
[aria-selected="true"] > .tab-ico { opacity: 1; color: var(--pt-ink, #d6d4ff); }
.sset-subpop .sset-pop-tabs button { gap: 6px; }
.sset-hd-tab .tab-ico { margin-right: 1px; }

/* Breathing room: nothing sits tight against the window's edges */
.sset-subpop .sset-hd { padding-top: 6px; }
.sset-subpop .sl-bar { padding-left: var(--gutter, 18px); padding-right: var(--gutter, 18px); }
.sset-subpop .sl-row { padding-left: 14px; padding-right: 12px; }
.sset-subpop .sl-row-title, .sset-subpop .sl-row-meta { padding-right: 2px; }
.sset-subpop .sset-pop-tabs, .sset-subpop .ag-tabrow > .sset-pop-tabs { scroll-padding-inline: 8px; }

/* Range sliders and focus take the accent too */
.sset-subpop .sset-range { accent-color: var(--pt-acc); }
.sset-subpop input[type="checkbox"], .sset-subpop input[type="radio"] { accent-color: var(--pt-acc); }

@media (prefers-reduced-motion: reduce) { .wz-fold { transition: none; } }

/* ── One top edge for every window ─────────────────────────────────
   The window used to be centred on its own middle (top: 50% and
   translate -50%), so anything that changed its height — a setup wizard
   sizing itself to a step, a resize, a short viewport — moved its top
   edge and everything along it. It is now hung from --sset-top (defined
   with the header styles), which only depends on the viewport. Width is
   still centred. These override the entrance/exit keyframes as well,
   because their end frame (fill-mode both) would otherwise put the old
   vertical centring back. */
.sset-subpop:not([data-moved="1"]) { top: var(--sset-top); transform: translateX(-50%); transform-origin: 50% 0; }
.sset-subpop { min-height: min(${POP_MIN_H}px, var(--sset-ref-h)); max-height: calc(100vh - var(--sset-top) - 16px); }
.sset-subpop[data-moved="1"] { max-height: calc(100vh - 16px); }
.sset-subpop[data-fit="1"]:not([data-moved="1"]) { max-height: min(780px, calc(100vh - var(--sset-top) - 16px)); }
/* Scale from the top edge only (no drop), so the tab attached to that
   edge never parts from it while the window opens. */
@keyframes sset-subpop-in-v3 {
  from { opacity: 0; transform: translate(-50%, 0) scale(0.985); }
  to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
@keyframes sset-subpop-in {
  from { opacity: 0; transform: translate(-50%, 0) scale(0.985); }
  to   { opacity: 1; transform: translate(-50%, 0) scale(1); }
}
@keyframes sset-subpop-out {
  from { opacity: 1; transform: translate(-50%, 0) scale(1); }
  to   { opacity: 0; transform: translate(-50%, 3px) scale(0.985); }
}

/* ── One first line for every page ─────────────────────────────────
   With the page tabs moved out to the top pill, every page's first row
   (a list's search bar, a Preferences form, an open item's tabs) starts
   the same 14px under the window's edge. */
.sset-subpop:not([data-focus="1"]) .sset-subpop-body .sl-bar:first-child,
.sset-subpop:not([data-focus="1"]) .lnd > .sl-bar,
.sset-subpop:not([data-focus="1"]) .lnd > div > .sl-bar:first-child { padding-top: 14px; }
.sset-subpop .sset-pop-page > .sset-pop-body { padding-top: 14px; }

/* ── List rows: the refined pass ───────────────────────────────────
   Quiet by default, colour only where it carries meaning:
     • the picture is one tile shape for every kind of item, tinted with
       the accent (coins sit on a neutral tile so their brand colours
       stay calm);
     • the status is neutral text; only its small dot is coloured —
       accent for live (Replying, Available, Paid, Active, Accepting),
       amber for needs-attention, red for failed, grey for off;
     • medium weights, not bold; dividers start after the picture;
     • hover is a faint accent wash and the chevron leans forward. */
.sset-subpop .sl-list { border-radius: 12px; border-color: rgba(255,255,255,0.06);
  background: linear-gradient(180deg, rgba(255,255,255,0.018), rgba(255,255,255,0.008)); }
.sset-subpop .sl-list > .sl-row { position: relative; border-top: none; gap: 12px; }
.sset-subpop .sl-list > .sl-row + .sl-row::before { content: ""; position: absolute; top: 0; right: 0;
  left: calc(14px + 32px + 12px); height: 1px; background: rgba(255,255,255,0.05); pointer-events: none; }
@media (hover: hover) {
  .sset-subpop .sl-list > .sl-row:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 5%, rgba(255,255,255,0.015)); }
  .sset-subpop .sl-list > .sl-row:hover .sl-row-chev { color: rgba(210,212,228,0.7); transform: translateX(1.5px); }
}
.sset-subpop .sl-row .sl-row-chev { color: rgba(160,164,184,0.3); transition: color 140ms ease, transform 180ms cubic-bezier(0.22,1,0.36,1); }

.sl-tile { position: relative; flex: 0 0 auto; width: 32px; height: 32px; box-sizing: border-box; border-radius: 9px;
  display: inline-flex; align-items: center; justify-content: center; overflow: hidden;
  color: color-mix(in oklab, var(--acc, #6c63ff) 58%, #e9eaf5);
  background: linear-gradient(180deg,
    color-mix(in oklab, var(--acc, #6c63ff) 13%, rgba(255,255,255,0.03)),
    color-mix(in oklab, var(--acc, #6c63ff) 6%, rgba(255,255,255,0.012)));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 16%, rgba(255,255,255,0.05)),
    inset 0 1px 0 rgba(255,255,255,0.05); }
.sl-tile-letter { font-size: 12.5px; font-weight: 600; letter-spacing: -0.01em; line-height: 1; }
.sl-tile svg { display: block; width: 15px; height: 15px; stroke-width: 1.6; opacity: 1; }
.sl-tile[data-img="1"] { background: rgba(255,255,255,0.03); }
.sl-tile[data-img="1"] img { width: 100%; height: 100%; object-fit: cover; display: block; }
/* A hairline over images too, so photos sit in the same frame. */
.sl-tile[data-img="1"]::after { content: ""; position: absolute; inset: 0; border-radius: inherit; pointer-events: none;
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08); }
.sl-tile[data-coin="1"] { overflow: visible; color: inherit;
  background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.018));
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.065), inset 0 1px 0 rgba(255,255,255,0.05); }
.sl-tile[data-coin="1"] img { filter: saturate(0.82); }
.sset-subpop .sl-row[data-off="1"] .sl-row-media { opacity: 1; }
.sset-subpop .sl-row[data-off="1"] .sl-tile { filter: grayscale(1); opacity: 0.5; }

.sset-subpop .sl-row .sl-row-main { gap: 4px; }
.sset-subpop .sl-row .sl-row-title { font-size: 12.5px; font-weight: 500; letter-spacing: -0.01em; color: rgba(236,238,248,0.94); }
.sset-subpop .sl-row[data-off="1"] .sl-row-main { opacity: 1; }
.sset-subpop .sl-row[data-off="1"] .sl-row-title { color: rgba(200,202,220,0.55); }
.sset-subpop .sl-row .sl-row-amt { font-size: 12px; font-weight: 500; letter-spacing: -0.005em; color: rgba(226,228,240,0.9); }
.sset-subpop .sl-row[data-off="1"] .sl-row-value { opacity: 0.5; }

/* Status: neutral words, one small coloured dot on the text's centre line. */
.sset-subpop .sl-row .sl-stat { --dot: rgba(160,164,184,0.5); height: 14px; gap: 7px;
  font-size: 11px; font-weight: 450; line-height: 14px; letter-spacing: -0.002em; color: rgba(164,168,188,0.78); }
.sset-subpop .sl-row .sl-stat i { width: 6px; height: 6px; margin: 0; background: var(--dot); box-shadow: none; }
.sset-subpop .sl-row .sl-stat[data-s="active"],
.sset-subpop .sl-row .sl-stat[data-s="confirmed"] { --dot: color-mix(in oklab, var(--acc, #6c63ff) 78%, #fff); }
.sset-subpop .sl-row .sl-stat[data-s="pending"],
.sset-subpop .sl-row .sl-stat[data-s="expiring"],
.sset-subpop .sl-row .sl-stat[data-s="suspended"] { --dot: rgb(214,170,102); }
.sset-subpop .sl-row .sl-stat[data-s="failed"] { --dot: rgb(222,114,106); }
.sset-subpop .sl-row .sl-stat[data-s="expired"],
.sset-subpop .sl-row .sl-stat[data-s="cancelled"] { --dot: rgba(160,164,184,0.42); }

/* ── License API page ──────────────────────────────────────────────
   Built from the list parts (.sl-list, .sl-row, .sl-tile) so it reads
   like every other page in these windows. Sections are a quiet caption,
   one grouped card, and at most one line of help. */
.sset-subpop .lapi { flex: 1 1 auto; min-height: 0; overflow-y: auto; box-sizing: border-box;
  padding: 14px var(--gutter, 18px) 22px; display: flex; flex-direction: column; gap: 20px;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.10) transparent; }
.sset-subpop .lapi-sec { display: flex; flex-direction: column; min-width: 0; }
.sset-subpop .lapi-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
  margin: 0 2px 8px; font-size: 11.5px; font-weight: 500; letter-spacing: -0.003em; color: rgba(170,174,194,0.78); }
.sset-subpop .lapi-cap-link { appearance: none; background: none; border: none; padding: 0; margin: 0; font: inherit;
  font-size: 11.5px; font-weight: 500; color: rgba(170,174,194,0.7); cursor: pointer; transition: color 120ms ease; }
@media (hover: hover) { .sset-subpop .lapi-cap-link:not(:disabled):hover { color: rgb(236,132,124); } }
.sset-subpop .lapi-cap-link:focus-visible { outline: none; color: rgb(236,132,124); text-decoration: underline; text-underline-offset: 3px; }
.sset-subpop .lapi-cap-link:disabled { opacity: 0.45; cursor: default; }
.sset-subpop .lapi .sl-row[data-static="1"] { cursor: default; }
@media (hover: hover) { .sset-subpop .lapi .sl-list > .sl-row[data-static="1"]:hover { background: transparent; } }
.sset-subpop .lapi-val { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; line-height: 14px; letter-spacing: 0;
  color: rgba(170,174,194,0.8); }
.sset-subpop .lapi-val[data-secret="1"] { letter-spacing: 0.12em; }
.sset-subpop .lapi-val[data-plain="1"] { font-family: inherit; font-size: 11px; letter-spacing: -0.002em; }
.sset-subpop .lapi-note { margin: 8px 2px 0; font-size: 11px; line-height: 1.5; color: rgba(150,154,176,0.72); }
.sset-subpop .lapi-note code { font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; color: rgba(210,212,228,0.85); }
.sset-subpop .lapi-trail-ico { display: inline-flex; color: rgba(160,164,184,0.45); transition: color 140ms ease; }
@media (hover: hover) { .sset-subpop .lapi .sl-row:hover .lapi-trail-ico { color: rgba(210,212,228,0.75); } }
/* Small square actions at the end of a row. */
.sset-subpop .lapi-ib { position: relative; width: 28px; height: 28px; padding: 0; margin: 0; flex: 0 0 auto;
  display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; cursor: pointer;
  background: transparent; border: none; color: rgba(170,174,194,0.62); transition: background-color 120ms ease, color 120ms ease; }
@media (hover: hover) { .sset-subpop .lapi-ib:not(:disabled):hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.06); } }
.sset-subpop .lapi-ib:focus-visible { outline: none; box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-subpop .lapi-ib:disabled { opacity: 0.35; cursor: default; }
.sset-subpop .lapi .sl-row-trail { gap: 2px; }
/* Developer reference: a quiet fold, then plain code blocks. */
.sset-subpop .lapi-fold { appearance: none; display: inline-flex; align-items: center; gap: 7px; align-self: flex-start;
  margin: 0; padding: 4px 2px; background: none; border: none; font: inherit; font-size: 11.5px; font-weight: 500;
  color: rgba(170,174,194,0.78); cursor: pointer; transition: color 120ms ease; }
@media (hover: hover) { .sset-subpop .lapi-fold:hover { color: var(--t1, #eeeef5); } }
.sset-subpop .lapi-fold:focus-visible { outline: none; color: var(--t1, #eeeef5); }
.sset-subpop .lapi-fold-chev { display: inline-flex; transition: transform 180ms cubic-bezier(0.22,1,0.36,1); }
.sset-subpop .lapi-fold[aria-expanded="true"] .lapi-fold-chev { transform: rotate(90deg); }
.sset-subpop .lapi-ref { margin-top: 10px; display: flex; flex-direction: column; }
.sset-subpop .lapi-code-cap { margin: 12px 2px 6px; font-size: 11px; font-weight: 500; color: rgba(170,174,194,0.72); }
.sset-subpop .lapi-code-cap:first-child { margin-top: 0; }
.sset-subpop .lapi-code { margin: 0; padding: 11px 13px; border-radius: 10px; overflow-x: auto;
  background: rgba(0,0,0,0.2); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.055);
  font-family: var(--mono, ui-monospace, monospace); font-size: 10.5px; line-height: 1.6; color: rgba(206,208,224,0.86); }
.sset-subpop .lapi-code[data-wrap="1"] { white-space: pre-wrap; word-break: break-all; }
@media (prefers-reduced-motion: reduce) { .sset-subpop .lapi-fold-chev { transition: none; } }

/* ── One list row everywhere ───────────────────────────────────────
   Agents, Catalog, Licenses, Invoices and Wallets all use the same row:
   picture, name, ONE status (dot + word), at most one value on the right,
   chevron. No secondary text, no switches — switching on/off happens on
   the item's own page. */
.sset-subpop .sl-row .sl-row-meta { gap: 0; }
/* Things (agents) take the product thumbnail's rounded square; people and
   coins stay round. */
.sset-subpop .sl-avatar[data-shape="square"] { border-radius: 8px; }
/* Billing period, folded into the price: $9.99/mo */
.sset-subpop .sl-row-per { margin-left: 1px; font-size: 11px; font-weight: 450; color: rgba(160,164,184,0.62); }
/* A word on the right (a license's product) instead of a figure: quieter
   than an amount, and it gives way to the name when space is short. */
.sset-subpop .sl-row-value[data-text="1"] { flex: 0 1 auto; min-width: 0; max-width: 45%; }
.sset-subpop .sl-row-value[data-text="1"] .sl-row-amt { max-width: 100%; font-size: 11.5px; font-weight: 450; color: rgba(180,183,202,0.8);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* ── Setup wizards, compact layout ─────────────────────────────────
   Product, agent and wallet wizards share these. Kept last so they win
   over the base wizard rules above, and scoped to .wz so the wallet and
   license detail pages (which reuse .wz-row / .wz-group) keep their own
   spacing. Budget: a header row about 34px tall, rows 38px, choice tiles
   in one band, the review as a two-column grid. */
.sset-subpop .wz .wz-inner { padding: 16px 18px 14px; }
.sset-subpop .wz .wz-stage { gap: 14px; }
.sset-subpop .wz .wz-body { gap: 12px; }
.sset-subpop .wz .wz-sec { gap: 6px; }

/* Header: glyph, title + one line, step count. Left aligned. */
.sset-subpop .wz .wz-head { flex-direction: row; align-items: center; text-align: left; gap: 11px; min-width: 0; }
.sset-subpop .wz .wz-glyph { width: 32px; height: 32px; margin: 0; border-radius: 9px;
  color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 12%, rgba(255,255,255,0.02));
  box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--acc, #6c63ff) 30%, transparent); }
.sset-subpop .wz .wz-coinhero { display: inline-flex; flex: 0 0 auto; margin: 0; border-radius: 50%; box-shadow: 0 0 0 2px rgba(255,255,255,0.04); }
.sset-subpop .wz .wz-head-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.sset-subpop .wz .wz-title { font-size: 14px; font-weight: 620; letter-spacing: -0.012em; line-height: 1.25; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
.sset-subpop .wz .wz-sub { margin: 0; max-width: none; font-size: 11.5px; line-height: 1.35; color: rgba(160,164,184,0.68);
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-count { flex: 0 0 auto; align-self: flex-start; margin-top: 2px; font-size: 11px; font-weight: 500;
  color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }
.wz-count i { font-style: normal; margin: 0 1px; opacity: 0.6; }

/* Rows */
.sset-subpop .wz .wz-group { border-radius: 10px; background: rgba(255,255,255,0.035); }
.sset-subpop .wz .wz-row { min-height: 38px; padding: 0 12px; gap: 10px; }
.sset-subpop .wz .wz-row + .wz-row::before { left: 12px; background: rgba(255,255,255,0.055); }
.sset-subpop .wz .wz-row[data-ico] + .wz-row[data-ico]::before { left: 44px; }
.sset-subpop .wz .wz-row-label { flex-basis: 64px; font-size: 12px; color: rgba(186,190,212,0.8); font-weight: 500; }
.sset-subpop .wz .wz-row-txt { padding: 7px 0; gap: 1px; }
.sset-subpop .wz .wz-row-title { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sset-subpop .wz .wz-row-hint { font-size: 10.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.sset-subpop .wz .wz-ico { width: 22px; height: 22px; border-radius: 6px; background: rgba(255,255,255,0.06); color: rgba(200,203,222,0.85); }
.sset-subpop .wz .wz-ico .sel-sym { font-size: 11.5px; }
.sset-subpop .wz .wz-row[data-ico] > .wz-input { margin-left: 0; }
.wz-grow { flex: 1 1 auto; min-width: 0; }
.sset-subpop .wz .wz-input { height: 38px; font-size: 12.5px; }
.sset-subpop .wz .wz-input-end { flex: 0 1 140px; text-align: right; }
.sset-subpop .wz .wz-select { max-width: 60%; font-size: 12px; }
.sset-subpop .wz .wz-select[data-align="start"] { max-width: none; }
.wz-row-seg { flex: 0 0 auto; }
.wz-row-seg .wz-seg { min-width: 200px; }
.sset-subpop .wz .wz-cap { padding: 0 2px; font-size: 11px; }
.sset-subpop .wz .wz-note { padding: 0 2px; font-size: 10.5px; }
.sset-subpop .wz .wz-cap:has(+ .wz-group), .sset-subpop .wz .wz-group + .wz-note { padding-left: 2px; padding-right: 2px; }
.sset-subpop .wz .wz-note[data-warn="1"] { color: rgb(236,190,120); }
.sset-subpop .wz textarea.wz-textarea { min-height: 104px !important; padding: 10px 12px !important; font-size: 12.5px !important; }
.sset-subpop .wz textarea.wz-textarea.wd-addr-input { min-height: 54px !important; }

/* Segmented control and tone chips, a size down */
.sset-subpop .wz .wz-seg button { height: 24px; font-size: 11.5px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
.sset-subpop .wz .wz-chips { gap: 5px; }
.sset-subpop .wz .wz-chips button { height: 26px; padding: 0 11px; border-radius: 13px; font-size: 11.5px; }

/* Folding extras: one quiet 34px line */
.sset-subpop .wz .wz-fold { margin: 0; padding: 0 10px; height: 34px; gap: 8px; border-radius: 9px;
  background: transparent; border: 1px dashed rgba(255,255,255,0.08); }
.sset-subpop .wz .wz-sec[data-fold="open"] .wz-fold { height: 22px; padding: 0 2px; border-color: transparent; }
.sset-subpop .wz .wz-fold-cap { font-size: 11.5px; font-weight: 550; color: rgba(200,203,222,0.88); }
.sset-subpop .wz .wz-fold-sum { font-size: 11px; }
.wz-fold-ico { display: inline-flex; color: rgba(160,164,184,0.7); }
.sset-subpop .wz .wz-fold .fold-chev { flex: 0 0 auto; margin-left: 4px; color: rgba(160,164,184,0.55); transition: transform 160ms ease; }
.sset-subpop .wz .wz-sec[data-fold="shut"] .wz-fold-sum + .fold-chev { margin-left: 4px; }
.sset-subpop .wz .wz-sec[data-fold="shut"] .wz-fold-cap + .fold-chev { margin-left: auto; }
.sset-subpop .wz .wz-fold .fold-chev[data-open="1"] { transform: rotate(90deg); margin-left: auto; }

/* Choice tiles */
.wz-tiles { display: grid; grid-template-columns: repeat(var(--wz-cols, 2), minmax(0, 1fr)); gap: 6px; }
.wz-tile { position: relative; display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 50px; padding: 8px 12px; margin: 0;
  border: none; border-radius: 10px; font: inherit; color: inherit; text-align: left; cursor: pointer;
  background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07);
  transition: background-color 140ms ease, box-shadow 160ms ease; }
@media (hover: hover) { .wz-tile:hover:not(:disabled) { background: rgba(255,255,255,0.06); } }
.wz-tile:disabled { opacity: 0.4; cursor: default; }
.wz-tile:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.wz-tile-ico { flex: 0 0 auto; width: 28px; height: 28px; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  color: rgba(200,203,222,0.85); background: rgba(255,255,255,0.06); transition: color 140ms ease, background-color 140ms ease; }
.wz-tile-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wz-tile-label { font-size: 12.5px; font-weight: 580; color: var(--t1, #eeeef5); letter-spacing: -0.006em;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-tile-hint { font-size: 10.5px; color: rgba(160,164,184,0.66); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-tile-mark { position: absolute; top: 7px; right: 7px; width: 14px; height: 14px; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; color: #fff; opacity: 0; transform: scale(0.6);
  background: color-mix(in oklab, var(--acc, #6c63ff) 85%, #15162a);
  transition: opacity 140ms ease, transform 200ms cubic-bezier(0.32,0.72,0,1); }
.wz-tile[aria-checked="true"] { background: color-mix(in oklab, var(--acc, #6c63ff) 11%, rgba(255,255,255,0.025));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.wz-tile[aria-checked="true"] .wz-tile-ico { color: color-mix(in oklab, var(--acc, #6c63ff) 35%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 22%, transparent); }
.wz-tile[aria-checked="true"] .wz-tile-mark { opacity: 1; transform: none; }
/* Stacked: symbol over a short label, centred (3–5 columns) */
.wz-tiles[data-layout="stack"] .wz-tile { flex-direction: column; justify-content: center; gap: 5px; min-height: 64px; padding: 9px 6px; text-align: center; }
.wz-tiles[data-layout="stack"] .wz-tile-txt { align-items: center; max-width: 100%; }
.wz-tiles[data-layout="stack"] .wz-tile-ico { width: 26px; height: 26px; background: transparent; }
.wz-tiles[data-layout="stack"] .wz-tile[aria-checked="true"] .wz-tile-ico { background: transparent; }

/* Signal bars (reply feel, confirmations) */
.wz-bars { display: inline-flex; align-items: flex-end; gap: 2px; height: 14px; }
.wz-bars i { width: 3px; border-radius: 1px; background: rgba(255,255,255,0.16); }
.wz-bars i[data-on="1"] { background: currentColor; }

/* Product basics: image tile beside name + SKU, same height as both */
.wz-ident { display: flex; gap: 8px; align-items: stretch; min-width: 0; }
.wz-ident > .wz-group { flex: 1 1 auto; min-width: 0; }
.sset-subpop .wz .wz-well-wrap { position: relative; flex: 0 0 76px; margin: 0; display: block; }
.sset-subpop .wz .wz-well { width: 76px; height: 100%; min-height: 76px; border-radius: 10px; background: rgba(255,255,255,0.035);
  box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
.sset-subpop .wz .wz-well:not([data-has]) { box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); background-image: none; }
.wz-well-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; color: rgba(172,176,198,0.7); }
.wz-well-empty small { font-size: 10px; font-weight: 500; }
.sset-subpop .wz .wz-well-busy { font-size: 14px; }
.wz-well-x { position: absolute; top: -5px; right: -5px; width: 18px; height: 18px; padding: 0; margin: 0; border: none; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #fff;
  background: rgba(40,42,58,0.95); box-shadow: 0 0 0 1px rgba(255,255,255,0.14), 0 1px 3px rgba(0,0,0,0.4); }
.wz-well-x:hover { background: rgb(200,86,80); }
.wz-well-x:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }

/* One-line strip of small actions under a field */
.wz-mini { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 22px; }
.wz-mini > .wz-note { flex: 1 1 auto; min-width: 0; padding: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wz-chip { flex: 0 0 auto; display: inline-flex; align-items: center; gap: 5px; height: 22px; padding: 0 9px; margin: 0; border: none;
  border-radius: 11px; font: inherit; font-size: 11px; font-weight: 500; cursor: pointer; color: rgba(200,203,222,0.85);
  background: rgba(255,255,255,0.05); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.08); }
.wz-chip:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.08); }
.wz-chip:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.wz-mini > .wz-err { min-width: 0; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Price: the amount stays the focus, a size smaller */
.sset-subpop .wz .wz-amount { padding: 12px 12px 8px; }
.sset-subpop .wz .wz-amount-sym { font-size: 18px; }
.sset-subpop .wz .wz-amount input { font-size: 28px; }
.sset-subpop .wz .wz-amount-seg { padding: 0 10px 10px; }

/* Currency tiles (wallet) */
.sset-subpop .wz .wz-coins { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 5px; }
.sset-subpop .wz .wz-coin { height: 38px; padding: 0 9px; gap: 8px; border-radius: 9px; }
.sset-subpop .wz .wz-coin-name { font-size: 11.5px; }
.sset-subpop .wz .wz-coin-net { font-size: 10px; }
.sset-subpop .wz .wz-coin-other { width: 20px; height: 20px; }

/* Review: two-column summary + the go-live switch */
.wz-sum { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); border-radius: 10px; overflow: hidden;
  background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
.wz-sum-cell { position: relative; display: flex; align-items: center; gap: 9px; min-width: 0; min-height: 44px; padding: 6px 12px; margin: 0;
  border: none; background: transparent; font: inherit; color: inherit; text-align: left; cursor: pointer; transition: background-color 120ms ease; }
.wz-sum-cell:nth-child(2n)::after { content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 1px; background: rgba(255,255,255,0.055); }
.wz-sum-cell:nth-child(n+3)::before { content: ""; position: absolute; top: 0; left: 12px; right: 12px; height: 1px; background: rgba(255,255,255,0.055); }
@media (hover: hover) { .wz-sum-cell:hover { background: rgba(255,255,255,0.035); } }
.wz-sum-cell:focus-visible { outline: none; box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 60%, transparent); }
.wz-sum-ico { flex: 0 0 auto; display: inline-flex; color: color-mix(in oklab, var(--acc, #6c63ff) 35%, #a8aac4); opacity: 0.85; }
.wz-sum-txt { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wz-sum-k { font-size: 10.5px; color: rgba(160,164,184,0.66); white-space: nowrap; }
.wz-sum-v { font-size: 12px; font-weight: 500; color: var(--t1, #eeeef5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-variant-numeric: tabular-nums; }
.wz-sum-v[data-dim="1"] { color: rgba(160,164,184,0.5); font-weight: 450; }

/* Footer: icon + word buttons, dots in the middle */
.sset-subpop .wz .wz-foot { padding: 10px 14px 12px; gap: 8px; border-top-color: rgba(255,255,255,0.05); }
.sset-subpop .wz .wz-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 13px;
  border-radius: 8px; font-size: 12px; }
.sset-subpop .wz .wz-btn[data-kind="primary"], .sset-subpop .wz .wz-btn[data-kind="tinted"] { min-width: 96px; }
.sset-subpop .wz .wz-btn[data-kind="plain"] { padding: 0 10px 0 7px; margin-left: -4px; gap: 4px; }
.sset-subpop .wz .wz-dots { gap: 5px; }
.sset-subpop .wz .wz-dot { width: 5px; height: 5px; }
.sset-subpop .wz .wz-dot[data-s="cur"] { width: 14px; }
.sset-subpop .wz .wz-need { font-size: 11px; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }

/* Narrow windows: tiles and summary fold to fewer columns, the Back
   and Cancel words drop and only their symbols remain. */
@media (max-width: 440px) {
  .sset-subpop .wz .wz-inner { padding: 14px 12px 12px; }
  .wz-tiles:not([data-layout="stack"]) { grid-template-columns: minmax(0, 1fr); }
  .wz-row-seg .wz-seg { min-width: 0; }
  .sset-subpop .wz .wz-btn[data-kind="plain"] span { display: none; }
  .sset-subpop .wz .wz-coins { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) {
  .wz-tile, .wz-tile-mark, .wz-sum-cell, .sset-subpop .wz .wz-fold .fold-chev { transition: none; }
}

/* ── Product / package / add-on editor ─────────────────────────────
   One scrolling page in the wizard's parts (.wz-group, .wz-row, tiles),
   with a fixed footer. Sections are separated by space and a quiet
   caption, not by cards or tabs. */
.pe { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
.pe-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden;
  scrollbar-width: thin; scrollbar-color: rgba(255,255,255,0.12) transparent; }
.pe-scroll::-webkit-scrollbar { width: 6px; }
.pe-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.12); border-radius: 3px; }
.sset-subpop .pe .pe-body { flex: 0 0 auto; gap: 18px; padding: 16px var(--gutter, 18px) 20px; }
.pe-sec { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.pe-cap { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 0 2px;
  font-size: 11px; font-weight: 550; color: rgba(172,176,198,0.72); letter-spacing: -0.003em; }
.pe-cap small { font-size: 10.5px; font-weight: 450; color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }

/* Price: amount and billing on one line, three small cells beneath */
.pe-price { display: flex; align-items: center; gap: 10px; padding: 8px 8px 8px 12px; min-width: 0; }
.pe-amount { flex: 1 1 auto; min-width: 0; display: flex; align-items: baseline; gap: 3px; cursor: text; }
.pe-amount-sym { font-size: 15px; font-weight: 600; color: rgba(172,176,198,0.6); }
.sset-subpop .pe .pe-amount input { flex: 1 1 auto; min-width: 0; width: 100%; padding: 0; margin: 0; border: none; outline: none;
  background: transparent; box-shadow: none; font: inherit; font-size: 22px; font-weight: 680; letter-spacing: -0.03em;
  color: var(--t1, #eeeef5); font-variant-numeric: tabular-nums; }
.sset-subpop .pe .pe-amount input::placeholder { color: rgba(160,164,184,0.3); }
.pe-price > .wz-seg { flex: 0 0 auto; width: 236px; }
.pe-split { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr) minmax(0, 1.25fr);
  border-top: 1px solid rgba(255,255,255,0.055); }
.pe-cell { position: relative; display: flex; align-items: center; gap: 8px; min-width: 0; height: 38px; padding: 0 10px; cursor: pointer; }
.pe-cell + .pe-cell::before { content: ""; position: absolute; left: 0; top: 9px; bottom: 9px; width: 1px; background: rgba(255,255,255,0.055); }
.sset-subpop .pe .pe-cell .wz-input { height: 36px; min-width: 0; font-size: 12px; }
.sset-subpop .pe .pe-cell .wz-input[type="date"] { text-align: left; }
.sset-subpop .pe .pe-cell .wz-input[type="date"][data-empty="1"] { color: rgba(160,164,184,0.45); }
.sset-subpop .pe .pe-cell .wz-select { margin-left: 0; flex: 1 1 auto; max-width: none; justify-content: space-between; color: var(--t1, #eeeef5); }
.sset-subpop .pe .pe-cell .wz-ico { width: 20px; height: 20px; }

/* Rows that open in place (features, delivery) */
.pe-disc { position: relative; }
.pe-disc + .pe-disc::before { content: ""; position: absolute; top: 0; left: 44px; right: 0; height: 1px; background: rgba(255,255,255,0.055); z-index: 1; }
.pe-disc[data-open="1"] + .pe-disc::before { left: 0; }
.pe-sum { flex: 0 1 auto; min-width: 0; font-size: 11.5px; color: rgba(160,164,184,0.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pe-sum[data-set="1"] { color: rgba(200,203,222,0.85); }
.sset-subpop .pe .pe-disc .fold-chev { flex: 0 0 auto; color: rgba(160,164,184,0.5); transition: transform 160ms ease; }
.sset-subpop .pe .pe-disc .fold-chev[data-open="1"] { transform: rotate(90deg); }
.pe-disc[data-open="1"] > .wz-row .wz-ico { color: color-mix(in oklab, var(--acc, #6c63ff) 35%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 20%, transparent); }
.pe-panel { display: flex; flex-direction: column; gap: 8px; padding: 2px 12px 12px 44px; animation: wz-fade 160ms ease both; }

/* Footer */
.pe-foot { flex-shrink: 0; display: flex; align-items: center; gap: 6px; padding: 10px var(--gutter, 18px) 12px;
  border-top: 1px solid rgba(255,255,255,0.05); }
.pe-foot-sp { flex: 1 1 auto; }
.pe-avail { display: inline-flex; align-items: center; gap: 8px; height: 30px; padding: 0 10px 0 8px; margin: 0 0 0 -8px; border: none;
  border-radius: 8px; background: transparent; font: inherit; font-size: 12px; font-weight: 550; color: rgba(172,176,198,0.75); cursor: pointer; }
.pe-avail[data-on="1"] { color: var(--t1, #eeeef5); }
.pe-avail:hover { background: rgba(255,255,255,0.04); }
.pe-avail:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pe-icon-btn { width: 30px; height: 30px; padding: 0; margin: 0; border: none; border-radius: 8px; display: inline-flex; align-items: center; justify-content: center;
  background: transparent; color: rgba(172,176,198,0.7); cursor: pointer; transition: background-color 120ms ease, color 120ms ease; }
.pe-icon-btn[data-tone="danger"]:hover { color: rgb(240,130,124); background: rgba(230,110,104,0.1); }
.pe-icon-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.sset-subpop .pe-foot .wz-btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 30px; padding: 0 13px;
  min-width: 0; border-radius: 8px; font-size: 12px; }
.sset-subpop .pe-foot .wz-btn:disabled { opacity: 0.38; cursor: default; }

/* Photos and videos strip (wizard + editor) */
.gal { display: flex; flex-direction: column; gap: 7px; min-width: 0; border-radius: 12px; }
.gal[data-drag="1"] { box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.gal-empty { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 64px; padding: 12px 14px; margin: 0;
  border: 1px dashed rgba(255,255,255,0.14); border-radius: 10px; background: rgba(255,255,255,0.02);
  font: inherit; color: inherit; text-align: left; cursor: pointer; transition: background-color 140ms ease, border-color 140ms ease; }
.gal-empty:hover { background: rgba(255,255,255,0.04); border-color: color-mix(in oklab, var(--acc, #6c63ff) 45%, rgba(255,255,255,0.14)); }
.gal-empty:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.gal-empty-ico { flex: 0 0 auto; width: 36px; height: 36px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center;
  color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #ffffff); background: color-mix(in oklab, var(--acc, #6c63ff) 14%, transparent); }
.gal-empty-txt { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.gal-empty-txt strong { font-size: 12.5px; font-weight: 600; color: var(--t1, #eeeef5); }
.gal-empty-txt small { font-size: 11px; color: rgba(160,164,184,0.66); }
.gal-grid { display: grid; grid-template-columns: repeat(auto-fill, 58px); gap: 6px; }
.gal-tile, .gal-add { position: relative; aspect-ratio: 1 / 1; min-width: 0; border-radius: 10px; overflow: hidden;
  background: rgba(255,255,255,0.04); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.07); }
.gal-tile img { width: 100%; height: 100%; object-fit: cover; display: block; }
.gal-tile[data-cover="1"] { box-shadow: inset 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 70%, transparent); }
.gal-ico { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 4px; color: rgba(200,203,222,0.85); text-align: center; }
.gal-ico small { max-width: 100%; font-size: 9.5px; color: rgba(160,164,184,0.75); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gal-ico[data-bad="1"] { color: rgb(236,160,150); }
.gal-yt { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); display: inline-flex; filter: drop-shadow(0 2px 6px rgba(0,0,0,0.5)); }
.gal-badge { position: absolute; left: 4px; bottom: 4px; height: 15px; padding: 0 5px; border-radius: 8px; display: inline-flex; align-items: center;
  font-size: 9px; font-weight: 650; color: #fff; background: color-mix(in oklab, var(--acc, #6c63ff) 80%, #15162a); letter-spacing: 0.01em; }
.gal-x, .gal-star { position: absolute; top: 4px; width: 18px; height: 18px; padding: 0; margin: 0; border: none; border-radius: 50%;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer; color: #fff;
  background: rgba(14,15,26,0.78); box-shadow: 0 0 0 1px rgba(255,255,255,0.14); opacity: 0; transition: opacity 120ms ease, background-color 120ms ease; }
.gal-x { right: 4px; }
.gal-star { left: 4px; }
.gal-tile:hover .gal-x, .gal-tile:hover .gal-star, .gal-x:focus-visible, .gal-star:focus-visible { opacity: 1; }
@media (hover: none) { .gal-x, .gal-star { opacity: 1; } }
.gal-x:hover { background: rgb(200,86,80); }
.gal-star:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 85%, #15162a); }
.gal-add { display: inline-flex; align-items: center; justify-content: center; padding: 0; margin: 0; border: none; cursor: pointer; font: inherit;
  color: rgba(190,194,214,0.8); background: transparent; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.12);
  border: 1px dashed rgba(255,255,255,0.14); box-sizing: border-box; box-shadow: none; }
.gal-add:hover { color: var(--t1, #eeeef5); background: rgba(255,255,255,0.04); }
.gal-add:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.gal-foot { display: flex; align-items: center; gap: 8px; min-width: 0; min-height: 22px; }
.gal-note { flex: 1 1 auto; min-width: 0; display: inline-flex; align-items: center; gap: 6px; padding-left: 2px;
  font-size: 11px; color: rgba(160,164,184,0.7); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.gal-note svg { flex: 0 0 auto; color: color-mix(in oklab, var(--acc, #6c63ff) 40%, #a8aac4); }
.gal-count { flex: 0 0 auto; font-size: 10.5px; color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }
.gal-close { flex: 0 0 auto; width: 22px; height: 22px; padding: 0; margin: 0 -4px 0 0; border: none; border-radius: 6px; background: transparent;
  color: rgba(172,176,198,0.7); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; }
.gal-close:hover { background: rgba(255,255,255,0.06); color: var(--t1, #eeeef5); }
.wz-chip:disabled { opacity: 0.4; cursor: default; }
@media (prefers-reduced-motion: reduce) { .gal-x, .gal-star, .gal-empty { transition: none; } }

/* ── Preferences pages ─────────────────────────────────────────────
   Short stacks of cards built from the wizard rows; a card's header
   opens it in place and only one is open at a time. */
.sset-subpop .sset-pop-body.pf-page { padding-top: 14px; gap: 0; }
.sset-subpop .wz.pf { flex: 0 0 auto; gap: 8px; }
.sset-subpop .wz.pf > .pe-cap { margin-top: 6px; }
.sset-subpop .wz.pf > .pe-cap:first-child { margin-top: 0; }
.pf-card > .pf-head { cursor: pointer; }
.pf-card[data-open="1"] > .pf-head { border-bottom: 1px solid rgba(255,255,255,0.055); }
.pf-card[data-open="1"] > .pf-head .wz-ico { color: color-mix(in oklab, var(--acc, #6c63ff) 35%, #ffffff);
  background: color-mix(in oklab, var(--acc, #6c63ff) 20%, transparent); }
.sset-subpop .pf .pf-head .fold-chev { flex: 0 0 auto; color: rgba(160,164,184,0.5); transition: transform 160ms ease; }
.sset-subpop .pf .pf-head .fold-chev[data-open="1"] { transform: rotate(90deg); }
.pf-body { animation: wz-fade 160ms ease both; }
.pf-block { padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
.pf-block + .wz-row::before { left: 12px !important; }
.sset-subpop .pf .pf-row .wz-row-txt { flex: 0 1 auto; min-width: 0; }
.pf-ctl { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; justify-content: flex-end; }
.pf-ctl .wz-seg { width: 100%; max-width: 236px; }
.pf-ctl .bc-swatches { gap: 6px; flex-wrap: nowrap; }
.pf-dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 1px rgba(255,255,255,0.2); }
.pf-range { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 236px; }
.pf-range .sset-range { flex: 1 1 auto; min-width: 0; margin: 0; }
.pf-range-val { flex: 0 0 44px; text-align: right; font-size: 11.5px; color: rgba(200,203,222,0.85); font-variant-numeric: tabular-nums; }
/* Background styles as a compact grid; palettes as slim chips */
.sset-subpop .pf .pf-tiles { grid-template-columns: repeat(auto-fill, minmax(56px, 1fr)); gap: 8px 6px; }
.sset-subpop .pf .pf-tiles .bc-tile { gap: 4px; }
.sset-subpop .pf .pf-tiles .bc-tile-prev { height: 34px; border-radius: 8px; }
.sset-subpop .pf .pf-tiles .bc-tile-label { font-size: 10px; }
.pf-pals { display: grid; grid-template-columns: repeat(auto-fill, minmax(86px, 1fr)); gap: 5px; }
.pf-pal { display: flex; align-items: center; gap: 7px; min-width: 0; height: 28px; padding: 0 8px 0 6px; margin: 0; border: none; border-radius: 8px;
  font: inherit; font-size: 11px; font-weight: 500; color: rgba(200,203,222,0.8); text-align: left; cursor: pointer;
  background: rgba(255,255,255,0.035); box-shadow: inset 0 0 0 0.5px rgba(255,255,255,0.07); }
.pf-pal:hover { background: rgba(255,255,255,0.06); }
.pf-pal[data-on="1"] { color: var(--t1, #eeeef5); background: color-mix(in oklab, var(--acc, #6c63ff) 12%, rgba(255,255,255,0.025));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pf-pal:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.pf-pal-bar { flex: 0 0 18px; height: 8px; border-radius: 4px; }
.pf-pal-name { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pf-solids { justify-content: flex-start; }
.pf-foot { display: flex; justify-content: flex-end; padding-top: 4px; }
.pf-row .wz-chip { margin-left: auto; }
.pf-row .wz-chip + .bc-switch { margin-left: 8px; }
@media (prefers-reduced-motion: reduce) { .pf-body { animation: none; } .sset-subpop .pf .pf-head .fold-chev { transition: none; } }
/* Package contents inside the editor: the catalog rows, a size down. */
.sset-subpop .pe-bundle .sl-list { border-radius: 10px; }
.sset-subpop .pe-bundle .sl-row { height: 44px; gap: 10px; }
.sset-subpop .pe-bundle .sl-row-media > * { transform: scale(0.82); transform-origin: center; }
.sset-subpop .pe-bundle .sl-row-meta { display: none; }
.sset-subpop .pe-bundle .sl-row-title { font-size: 12.5px; }
.sset-subpop .pe-bundle .sl-row-meta { font-size: 10.5px; }
@media (max-width: 480px) {
  .pe-price { flex-wrap: wrap; }
  .pe-price > .wz-seg { width: 100%; }
  .pe-split { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .pe-split > .pe-cell:last-child { grid-column: 1 / -1; border-top: 1px solid rgba(255,255,255,0.055); }
  .pe-split > .pe-cell:last-child::before { display: none; }
  .pe-panel { padding-left: 12px; }
}
@media (prefers-reduced-motion: reduce) { .pe-panel { animation: none; } .sset-subpop .pe .pe-disc .fold-chev { transition: none; } }

/* ── Compact frame ───────────────────────────────────────────────────
   The window is 440 x 560 (was 480 x 620) and its dock is 32px (was 36),
   so settings sits in proportion with the contact column and the header
   instead of dominating the screen. Everything inside steps down with it,
   roughly 10%, so no page looks crammed into the smaller frame: one 16px
   gutter, 28px controls, and card / list rows a notch tighter. Reading
   sizes are unchanged on purpose — the frame shrinks, the text does not.
   Last in the cascade, so these are the values every page ends up with. */
.sset-subpop { --gutter: 16px; --ctl-h: 28px; --ctl-px: 9px; }

/* Connections: section rhythm, card headers and bodies. */
.sset-subpop .sset-pop-body.cx { gap: 14px; padding-top: 12px; }
.sset-subpop .cx-head { min-height: 48px; padding: 7px 12px; gap: 10px; }
.sset-subpop .cx-body { padding: 2px 12px 12px; }

/* List pages (Agents, Catalog, Licenses, Payments). */
.sset-subpop .sl-row { height: 50px; gap: 10px; padding: 0 10px 0 12px; }
.sset-subpop .sl-empty { padding: 32px 18px; }
.sset-subpop .lnd-empty { padding: 28px 18px 26px; }
.sset-subpop .lnd-empty-sub { max-width: 280px; }
.sset-subpop .lnd-callout { margin-bottom: 12px; padding: 10px 12px; gap: 10px; }
.sset-subpop .lnd-group { margin-bottom: 14px; }
.sset-subpop .lnd-group:last-child { margin-bottom: 0; }
.sset-subpop .sl-more { height: 36px; }

/* Editors (wallet, product, package) and their footers. */
.sset-subpop .slw-body { gap: 16px; }
.sset-subpop .slw-coin { height: 40px; }
.sset-subpop .slw-fixed { height: 44px; }
.sset-subpop .slw-setrow { min-height: 50px; padding: 0 12px; }
.sset-subpop .slw-step button { width: 28px; }
.sset-subpop .slw-step output { min-width: 28px; line-height: 26px; }
.sset-subpop .slw-back { width: 26px; height: 26px; }
.sset-subpop .slw-foot { padding: 8px var(--gutter); }
.sset-subpop .pe-foot { padding: 8px var(--gutter) 10px; }
.sset-subpop .pe .pe-body { gap: 16px; padding: 14px var(--gutter) 18px; }
.sset-subpop .wz .wz-inner { padding: 14px var(--gutter) 12px; }
.sset-subpop .wd-api { padding: 14px var(--gutter) 16px; gap: 16px; }
.sset-subpop .wd-body { gap: 16px; }

/* Appearance: six background tiles to a row still fit the narrower
   frame, so every name ("Kaleidoscope" is the longest) reads in full. */
.sset-subpop .pf .pf-tiles { gap: 8px 5px; }
.sset-subpop .pf .pf-tiles .bc-tile-label { letter-spacing: -0.012em; }

/* ── One look, the Profile window's ───────────────────────────────
   Every settings page draws from the same few parts as the Profile
   window: borderless filled groups (10px corners, a 0.5px ring), rows
   with 12px insets and hairlines that start at the inset, 12.5px / 500
   titles over quiet 10.5px hints, small 11px grey captions, and 28px
   secondary buttons with 8px corners. Only geometry and surfaces are
   set here; accent, danger and state colours stay with their rules.
   The doubled class keeps this the last word without !important. */
.sset-subpop { --grp-r: 10px; --grp-bg: rgba(255,255,255,0.035); --grp-ring: inset 0 0 0 0.5px rgba(255,255,255,0.07);
  --grp-line: rgba(255,255,255,0.055); --grp-focus: 0 0 0 1.5px color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }

/* Groups */
.sset-subpop.sset-subpop :is(.sl-list, .cx-list, .wz-group, .agx-group, .slp-acc) {
  border: none; border-radius: var(--grp-r); background: var(--grp-bg); box-shadow: var(--grp-ring); }
.sset-subpop.sset-subpop .wz-group[data-field="1"]:focus-within,
.sset-subpop.sset-subpop .agx-group:focus-within:has(input:focus, textarea:focus) { box-shadow: var(--grp-ring), var(--grp-focus); }
/* Folded sections read as one row of a group */
.sset-subpop.sset-subpop .bc-fold[data-fold="shut"] > .agx-fold,
.sset-subpop.sset-subpop .sset-pop-section[data-fold="shut"] > .sset-fold,
.sset-subpop.sset-subpop .wz-sec[data-fold="shut"] > .wz-fold {
  border: none; border-radius: var(--grp-r); background: var(--grp-bg); box-shadow: var(--grp-ring); }

/* Dividers: one colour, starting at the row's inset */
.sset-subpop.sset-subpop .cx-card + .cx-card { border-top: none;
  background-image: linear-gradient(var(--grp-line), var(--grp-line)); background-size: calc(100% - 12px) 1px;
  background-position: 12px 0; background-repeat: no-repeat; }
.sset-subpop.sset-subpop .sl-list > .sl-row + .sl-row::before { left: calc(12px + 32px + 10px); background: var(--grp-line); }
.sset-subpop.sset-subpop .wz .wz-row + .wz-row::before { background: var(--grp-line); }
.sset-subpop.sset-subpop .pf-card[data-open="1"] > .pf-head { border-bottom-color: var(--grp-line); }

/* Rows */
.sset-subpop.sset-subpop .cx-head { min-height: 48px; padding: 8px 12px; }
.sset-subpop.sset-subpop .cx-body { padding: 2px 12px 12px; }
.sset-subpop.sset-subpop .sl-row { padding: 0 10px 0 12px; }
.sset-subpop.sset-subpop .sl-kv { padding: 8px 12px; }
.sset-subpop.sset-subpop .wz .wz-row { min-height: 44px; padding-left: 12px; padding-right: 12px; }

/* Titles and hints */
.sset-subpop.sset-subpop :is(.cx-title, .sl-row .sl-row-title, .wz-row-title, .agx-row-title) {
  font-size: 12.5px; font-weight: 500; letter-spacing: -0.008em; }
.sset-subpop.sset-subpop :is(.cx-sum, .wz .wz-row-hint, .agx .agx-row-hint) {
  font-size: 10.5px; line-height: 1.4; color: rgba(160,164,184,0.66); }

/* Captions above groups: small, grey, sentence case */
.sset-subpop.sset-subpop :is(.cx-cap, .pe-cap, .wz-cap, .slw-group-title, .agx-sec-head .agx-sec-title) {
  padding: 0 2px; font-size: 11px; font-weight: 550; letter-spacing: -0.003em; text-transform: none;
  color: rgba(172,176,198,0.72); }

/* Buttons: geometry only (colours stay with each variant) */
.sset-subpop.sset-subpop :is(.sset-btn, button.sg-btn, .sl-bar-add) {
  height: 28px; padding: 0 11px; border-radius: 8px; font-size: 11.5px; font-weight: 550; }
.sset-subpop.sset-subpop .sl-bar-add { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.08); }
@media (hover: hover) { .sset-subpop.sset-subpop .sl-bar-add:hover { background: rgba(255,255,255,0.07); border-color: rgba(255,255,255,0.13); } }
.sset-subpop.sset-subpop .wz-btn { height: 30px; border-radius: 8px; font-size: 12px; font-weight: 550; }
`;
  document.head.appendChild(st);   // (re)appended so it stays last
};

// ── Focused editing (item editors and detail pages) ──────────────
// When an item is open — a product, wallet, invoice, license or agent —
// the window shows only that item. The page tabs and the section circles
// step away, and the item's name floats just above the window as a quiet
// text trail ("Packages / Gold plan"); the first part goes back.
// Editors register with useSsetCrumb(parent, title, onBack) while open.
const SSET_CRUMB = {
  v: null, subs: new Set(),
  set(v) { this.v = v; this.subs.forEach(f => f()); },
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
};
const useSsetCrumb = (parent, title, onBack) => {
  const backRef = React.useRef(onBack);
  backRef.current = onBack;
  const tokenRef = React.useRef(null);
  React.useLayoutEffect(() => {
    // parent null = nothing open: withdraw this editor's trail, if shown.
    if (!parent) {
      if (tokenRef.current && SSET_CRUMB.v === tokenRef.current) SSET_CRUMB.set(null);
      tokenRef.current = null;
      return;
    }
    const token = { parent, title, back: () => { if (backRef.current) backRef.current(); } };
    tokenRef.current = token;
    SSET_CRUMB.set(token);
  }, [parent, title]);
  React.useLayoutEffect(() => () => {
    if (SSET_CRUMB.v === tokenRef.current) SSET_CRUMB.set(null);
  }, []);
};
const useSsetCrumbValue = () => {
  const [v, setV] = React.useState(SSET_CRUMB.v);
  React.useEffect(() => SSET_CRUMB.sub(() => setV(SSET_CRUMB.v)), []);
  return v;
};

// ── Fit-to-content window (setup wizards) ─────────────────────────
// While a setup wizard is on screen the window drops its fixed height and
// takes the height of the step instead (capped by the viewport), so there
// is no empty band above or below a short step. Wizards register with
// useSsetFit(); the window reads useSsetFitValue(). A count, not a flag,
// so a wizard that remounts never switches the mode off under another.
const SSET_FIT = {
  n: 0, subs: new Set(),
  add(d) { this.n = Math.max(0, this.n + d); this.subs.forEach(f => f()); },
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
};
const useSsetFit = (on = true) => {
  React.useLayoutEffect(() => {
    if (!on) return;
    SSET_FIT.add(1);
    return () => SSET_FIT.add(-1);
  }, [on]);
};
const useSsetFitValue = () => {
  const [v, setV] = React.useState(SSET_FIT.n > 0);
  React.useLayoutEffect(() => {
    const f = () => setV(SSET_FIT.n > 0);
    f();
    return SSET_FIT.sub(f);
  }, []);
  return v;
};

// ── Tab glyphs ──
// A small symbol before each tab label, so a row of tabs reads at a glance.
const TAB_ICON_PATHS = {
  overview:   <><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></>,
  licenses:   <><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.7 12.3 21 2M17 6l3 3M15 8l2 2"/></>,
  invoices:   <><path d="M5 3h14v18l-2.5-1.6L14 21l-2-1.6L10 21l-2.5-1.6L5 21V3z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/></>,
  wallets:    <><path d="M20 7H5a2 2 0 0 1 0-4h13v4"/><path d="M3 5v14a2 2 0 0 0 2 2h15V7"/><circle cx="16" cy="14" r="1.2"/></>,
  api:        <><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/></>,
  prod:       <><path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5M12 22V12"/></>,
  pkg:        <><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></>,
  add:        <><rect x="3" y="3" width="18" height="18" rx="4"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></>,
  all:        <><line x1="8" y1="6" x2="20" y2="6"/><line x1="8" y1="12" x2="20" y2="12"/><line x1="8" y1="18" x2="20" y2="18"/><circle cx="4" cy="6" r="1"/><circle cx="4" cy="12" r="1"/><circle cx="4" cy="18" r="1"/></>,
  active:     <><circle cx="12" cy="12" r="9"/><polyline points="8 12.5 11 15.5 16 9.5"/></>,
  paused:     <><circle cx="12" cy="12" r="9"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/></>,
  expiring:   <><circle cx="12" cy="13" r="8"/><polyline points="12 9 12 13 14.5 15"/><line x1="9.5" y1="2.5" x2="14.5" y2="2.5"/></>,
  inactive:   <><circle cx="12" cy="12" r="9"/><line x1="5.6" y1="5.6" x2="18.4" y2="18.4"/></>,
  identity:   <><circle cx="12" cy="8" r="4"/><path d="M5 21v-1a7 7 0 0 1 14 0v1"/></>,
  behaviour:  <path d="M21 12a8.5 8.5 0 0 1-12.4 7.6L3 21l1.4-5.1A8.5 8.5 0 1 1 21 12z"/>,
  capabilities: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>,
  realism:    <><path d="M3 12h3l3-7 4 14 3-7h5"/></>,
  details:    <><path d="M4 4h16v16H4z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="12" y2="17"/></>,
  pricing:    <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.3"/></>,
  delivery:   <><rect x="1" y="6" width="14" height="11" rx="1.5"/><path d="M15 9h4l3 3.5V17h-7"/><circle cx="6" cy="18.5" r="1.8"/><circle cx="18" cy="18.5" r="1.8"/></>,
  checkout:   <><circle cx="9" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/><path d="M2 3h3l2.6 12.4a2 2 0 0 0 2 1.6h8.6a2 2 0 0 0 2-1.6L22 7H6"/></>,
  bundle:     <><path d="M12 2 2 7l10 5 10-5-10-5z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/></>,
  apps:       <><path d="M9 2v5"/><path d="M15 2v5"/><path d="M6 7h12v4a6 6 0 0 1-12 0V7z"/><path d="M12 17v5"/></>,
  appearance: <><circle cx="12" cy="12" r="9"/><circle cx="8" cy="10" r="1.2"/><circle cx="12" cy="7.5" r="1.2"/><circle cx="16" cy="10" r="1.2"/><path d="M12 21a3 3 0 0 1 0-6h2a3 3 0 0 0 3-3"/></>,
  notifications: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></>,
  general:    <><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></>,
};
const TabIco = ({name, size = 12}) => TAB_ICON_PATHS[name] ? (
  <svg className="tab-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{TAB_ICON_PATHS[name]}</svg>
) : null;
// The glyph an open item's trail shows for the list it came from — the
// same symbol that list has in its tab pill, so the eye can follow it
// from the tab into the item. Keyed by the trail's parent name.
const SSET_CRUMB_ICON = {
  'agents':   <SetIcon size={13}>{SET_ICON_PATHS.agents}</SetIcon>,
  'products': <TabIco name="prod" size={13}/>,
  'packages': <TabIco name="pkg" size={13}/>,
  'add-ons':  <TabIco name="add" size={13}/>,
  'licenses': <TabIco name="licenses" size={13}/>,
  'invoices': <TabIco name="invoices" size={13}/>,
  'wallets':  <TabIco name="wallets" size={13}/>,
};

// ── Landing (the first screen of Agents, Catalog, Licenses & payments) ──
// The three list windows open onto the same frame, so switching between
// them only changes the words and rows, never the layout:
//   title + a line of live counts            [New …]
//   underline tabs with counts
//   search
//   one bordered list
const ensureLandingStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('lnd-style')) return;
  const st = document.createElement('style');
  st.id = 'lnd-style';
  st.textContent = `
.lnd { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; overflow: hidden; }
.lnd-head { flex-shrink: 0; display: flex; align-items: flex-end; justify-content: space-between; gap: 12px;
  min-height: 44px; padding: 20px var(--gutter, 18px) 14px; box-sizing: content-box; }
.lnd-head-txt { min-width: 0; display: flex; flex-direction: column; gap: 6px; }
.lnd-title { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.15; letter-spacing: -0.022em;
  color: var(--t1, #eeeef5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.lnd-stats { display: flex; flex-wrap: wrap; align-items: center; gap: 3px 14px; font-size: 11.5px; line-height: 1.3;
  color: rgba(160,164,184,0.7); }
.lnd-stat { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.lnd-stat b { font-weight: 600; color: rgba(226,228,240,0.92); font-variant-numeric: tabular-nums; }
.lnd-stat[data-tone]::before { content: ""; width: 6px; height: 6px; border-radius: 50%; flex: 0 0 auto; }
.lnd-stat[data-tone="ok"]::before   { background: rgb(88,190,140); }
.lnd-stat[data-tone="warn"]::before { background: rgb(222,168,92); }
.lnd-stat[data-tone="err"]::before  { background: rgb(230,110,104); }
.lnd-add { flex: 0 0 auto; height: var(--ctl-h, 30px); box-sizing: border-box; padding: 0 11px 0 9px; margin: 0;
  display: inline-flex; align-items: center; gap: 6px; font: inherit; font-size: 11.5px; font-weight: 550;
  letter-spacing: -0.005em; cursor: pointer; white-space: nowrap;
  color: color-mix(in oklab, var(--acc, #6c63ff) 30%, #f2f2f8);
  background: color-mix(in oklab, var(--acc, #6c63ff) 14%, transparent);
  border: 1px solid color-mix(in oklab, var(--acc, #6c63ff) 32%, transparent); border-radius: var(--ctl-r, 8px);
  transition: background-color 120ms ease, border-color 120ms ease; }
@media (hover: hover) { .lnd-add:hover { background: color-mix(in oklab, var(--acc, #6c63ff) 22%, transparent);
  border-color: color-mix(in oklab, var(--acc, #6c63ff) 48%, transparent); } }
.lnd-add:focus-visible { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--acc, #6c63ff) 40%, transparent); }
.lnd-add svg { opacity: 0.85; }
.sset-subpop .lnd-tabs { padding: 18px var(--gutter, 18px) 0; align-items: center; }
.sset-subpop .lnd-tabs::after { content: ""; flex: 0 0 1px; }
.lnd-tab { align-items: center; }
.lnd-tabs { flex-shrink: 0; display: flex; align-items: flex-end; gap: 18px; padding: 0 var(--gutter, 18px);
  border-bottom: 1px solid rgba(255,255,255,0.06); overflow-x: auto; scrollbar-width: none; }
.lnd-tabs::-webkit-scrollbar { display: none; }
.lnd-tab { position: relative; flex: 0 0 auto; appearance: none; background: none; border: none; margin: 0; cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px; padding: 0 0 11px; font: inherit; font-size: 12px; font-weight: 500;
  letter-spacing: -0.006em; white-space: nowrap; color: rgba(160,164,184,0.66); transition: color 140ms ease; }
.lnd-tab::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; border-radius: 2px 2px 0 0;
  background: transparent; transition: background-color 160ms ease; }
@media (hover: hover) { .lnd-tab:hover { color: rgba(226,228,240,0.9); } }
.lnd-tab[aria-selected="true"] { color: var(--t1, #eeeef5); }
.lnd-tab[aria-selected="true"]::after { background: color-mix(in oklab, var(--acc, #6c63ff) 75%, #fff); }
.lnd-tab:focus-visible { outline: none; color: var(--t1, #eeeef5); }
.lnd-tab:focus-visible::after { background: color-mix(in oklab, var(--acc, #6c63ff) 55%, transparent); }
.lnd-tab-n { font-size: 10.5px; font-weight: 500; color: rgba(160,164,184,0.5); font-variant-numeric: tabular-nums; }
.lnd-tab[aria-selected="true"] .lnd-tab-n { color: rgba(200,202,220,0.75); }
.lnd-tab[data-gap="1"] { margin-left: 6px; }
.lnd-tabs + .sl-bar, .lnd-tabs + * > .sl-bar:first-child { padding-top: 14px; }
.lnd-empty { padding: 36px 22px 34px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 6px; }
.lnd-empty-title { font-size: 12.5px; font-weight: 600; color: var(--t2, #c8c9d8); }
.lnd-empty-sub { font-size: 11.5px; line-height: 1.5; color: rgba(160,164,184,0.66); max-width: 300px; }
.lnd-empty .lnd-add { margin-top: 8px; }
.lnd-group { margin-bottom: 18px; }
.lnd-group:last-child { margin-bottom: 0; }
.lnd-group-head { display: flex; align-items: baseline; gap: 8px; margin: 2px 2px 8px; }
.lnd-group-title { font-size: 12px; font-weight: 600; letter-spacing: -0.006em; color: var(--t1, #eeeef5); }
.lnd-group-n { font-size: 11px; color: rgba(160,164,184,0.6); font-variant-numeric: tabular-nums; }
.lnd-group-more { margin-left: auto; appearance: none; background: none; border: none; padding: 0; font: inherit;
  font-size: 11.5px; font-weight: 500; color: color-mix(in oklab, var(--acc, #6c63ff) 45%, #eeeef5); cursor: pointer; }
.lnd-group-more:hover, .lnd-group-more:focus-visible { outline: none; text-decoration: underline; text-underline-offset: 3px; }
.lnd-callout { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; padding: 12px 14px; border-radius: 10px;
  background: color-mix(in oklab, rgb(222,168,92) 7%, transparent); border: 1px solid color-mix(in oklab, rgb(222,168,92) 28%, transparent); }
.lnd-callout-txt { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.lnd-callout-title { font-size: 12px; font-weight: 600; color: var(--t1, #eeeef5); }
.lnd-callout-sub { font-size: 11px; line-height: 1.4; color: rgba(190,192,210,0.75); }
@media (prefers-reduced-motion: reduce) { .lnd-tab, .lnd-tab::after, .lnd-add { transition: none; } }
`;
  document.head.appendChild(st);
};
// Section titles and counts are not shown at all (the tabs and the
// switcher circle already say where you are). Kept as a no-op so the views
// that still render it need no special casing.
const SsetLandHead = () => null;
const SsetLandAdd = ({label, onClick}) => (
  <button type="button" className="lnd-add" onClick={onClick}>
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
    {label}
  </button>
);
// ── Top pill slot ────────────────────────────────────────────────
// The window owns one fixed slot just above its top edge (see the popup
// below); a page puts its tabs there by portalling into it. The slot is
// found through this tiny store rather than context, because the pages
// are mounted through a few layers the popup doesn't control.
const SSET_TOP = {
  el: null, subs: new Set(),
  set(el) { if (this.el === el) return; this.el = el; this.subs.forEach(f => f()); },
  sub(f) { this.subs.add(f); return () => this.subs.delete(f); },
};
const useSsetTopSlot = () => {
  const [el, setEl] = React.useState(SSET_TOP.el);
  React.useLayoutEffect(() => {
    const f = () => setEl(SSET_TOP.el);
    f();
    return SSET_TOP.sub(f);
  }, []);
  return el;
};

// A row of symbol circles in the switcher's style: one 28px circle per
// tab, an accent disc that slides to the chosen one, the name (and count)
// on hover. The words are gone from the row itself; they live on the
// hover label and in aria-label, so screen readers still hear them.
//   tabs: [{id, label, icon?, n?, gap?, dot?}]
//     icon — glyph name in TAB_ICON_PATHS (defaults to id)
//     n    — count, shown in the hover label
//     gap  — a hairline before this tab (starts a new kind of thing)
//     dot  — 'ok' | 'warn' | 'err': a small status dot on the circle
const SsetTopTabs = ({tabs, value, onChange, label}) => {
  ensureSsetHeaderStyles();
  const indRef = React.useRef(null);
  const btnRefs = React.useRef({});
  const placedRef = React.useRef(false);
  const ids = tabs.map(t => t.id).join('|');
  const rowRef = React.useRef(null);
  const valueRef = React.useRef(value);
  valueRef.current = value;
  // Put the disc under the chosen circle. The pill is display:none while
  // an item is open (the back trail takes its place), and a hidden button
  // measures offsetLeft 0 — placing the disc then left it 6px off, over
  // the tab's edge, when you came back. So a hidden pill is not measured;
  // the next placement once it shows again is instant.
  const place = React.useCallback((slide) => {
    const ind = indRef.current;
    if (!ind) return;
    const btn = btnRefs.current[valueRef.current];
    if (!btn) { ind.setAttribute('data-hide', '1'); return; }
    if (!btn.offsetParent || !btn.offsetWidth) { placedRef.current = false; return; }
    ind.removeAttribute('data-hide');
    const tf = `translateX(${btn.offsetLeft}px)`;
    if (!slide || !placedRef.current) {
      placedRef.current = true;
      ind.setAttribute('data-instant', '1');
      ind.style.transform = tf;
      requestAnimationFrame(() => { if (indRef.current) indRef.current.removeAttribute('data-instant'); });
      return;
    }
    if (ind.style.transform !== tf) ind.style.transform = tf;
  }, []);
  React.useLayoutEffect(() => { place(true); }, [value, ids, place]);
  // Showing again (or the row changing width) re-measures, instantly.
  React.useLayoutEffect(() => {
    const row = rowRef.current;
    if (!row || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(row);
    return () => ro.disconnect();
  }, [place]);
  const onKey = (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft' && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const i = Math.max(0, tabs.findIndex(t => t.id === value));
    const n = tabs.length;
    const k = e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + n) % n;
    const next = tabs[k].id;
    onChange(next);
    const b = btnRefs.current[next];
    if (b) b.focus({ preventScroll: true });
  };
  const anyOn = tabs.some(t => t.id === value);
  return (
    <div ref={rowRef} className="sset-tp" role="tablist" aria-label={label} onKeyDown={onKey}>
      <span ref={indRef} className="sset-tp-ind" aria-hidden="true"/>
      {tabs.map((t, i) => {
        const on = t.id === value;
        const tip = t.n != null ? `${t.label} (${t.n})` : t.label;
        return (
          <React.Fragment key={t.id}>
            {t.gap && i > 0 && <span className="sset-tp-sep" aria-hidden="true"/>}
            <button type="button" role="tab" className="sset-tp-btn" data-tab={t.id}
              ref={el => { btnRefs.current[t.id] = el; }}
              aria-selected={on} aria-label={tip} data-tip={tip}
              tabIndex={on || (!anyOn && i === 0) ? 0 : -1}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { if (!on) onChange(t.id); }}>
              <TabIco name={t.icon || t.id} size={13}/>
              {t.dot && <span className="sset-tp-dot" data-tone={t.dot} aria-hidden="true"/>}
            </button>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// A page's tabs (Agents, Catalog, Licenses & payments). They are drawn in
// the window's top slot, outside the window, as a symbol pill — so the
// page itself starts right at the window's edge and every page, tab and
// open item begins on the same line. Outside a settings window (no slot)
// the same pill is drawn in place.
// tabs: [{id, label, n?, gap?, icon?, dot?}] — see SsetTopTabs.
const SsetLandTabs = ({tabs, value, onChange, label}) => {
  ensureLandingStyles();
  const slot = useSsetTopSlot();
  const pill = <SsetTopTabs tabs={tabs} value={value} onChange={onChange} label={label}/>;
  if (slot) return ReactDOM.createPortal(pill, slot);
  return <div style={{display:'flex', padding:'12px var(--gutter, 18px) 0'}}>{pill}</div>;
};
// Empty list: what's missing, why it matters, and the one thing to do.
const SsetLandEmpty = ({title, sub, action}) => {
  ensureLandingStyles();
  return (
    <div className="lnd-empty">
      <div className="lnd-empty-title">{title}</div>
      {sub && <div className="lnd-empty-sub">{sub}</div>}
      {action && <SsetLandAdd label={action.label} onClick={action.onClick}/>}
    </div>
  );
};

// ── Shared list helpers (Catalog, Licenses, Wallets, Invoices) ─────
// The picture at the start of every list row: one quiet rounded tile,
// tinted with the accent. Shows the item's image when it has one (falls
// back if it fails to load), else a letter, else the given glyph.
// `coin` puts a coin logo on a neutral tile instead, so brand colours
// don't turn the list into a row of bright discs.
const SlTile = ({img, letter, coin, children}) => {
  const [err, setErr] = React.useState(false);
  React.useEffect(() => setErr(false), [img]);
  const showImg = !!img && !err;
  return (
    <span className="sl-tile" data-img={showImg ? '1' : undefined} data-coin={coin ? '1' : undefined} aria-hidden="true">
      {showImg ? <img src={img} alt="" draggable={false} onError={() => setErr(true)}/>
        : letter ? <span className="sl-tile-letter">{letter}</span>
        : children}
    </span>
  );
};
// Search field for a list toolbar. `count` fills the placeholder
// ("Search 240 invoices") so the field also tells you how many there are.
const BcSearch = ({value, onChange, placeholder}) => (
  <label className="sl-search">
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>
    </svg>
    <input type="search" value={value} placeholder={placeholder} aria-label={placeholder}
      onChange={e => onChange(e.target.value)}
      onKeyDown={e => { if (e.key === 'Escape' && value) { e.stopPropagation(); e.preventDefault(); onChange(''); } }}/>
    {value && (
      <button type="button" className="sl-search-clear" aria-label="Clear search" onClick={() => onChange('')}>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    )}
  </label>
);
// Long lists render in pages of 50 rows so a store with thousands of
// invoices or licenses still opens instantly. `resetKey` (the search text
// and filter) sends the list back to the first page when it changes.
const BC_PAGE = 50;
const useBcPaged = (items, resetKey) => {
  const [limit, setLimit] = React.useState(BC_PAGE);
  React.useEffect(() => { setLimit(BC_PAGE); }, [resetKey]);
  const list = items || [];
  return {
    shown: list.length > limit ? list.slice(0, limit) : list,
    rest: Math.max(0, list.length - limit),
    more: () => setLimit(l => l + BC_PAGE),
  };
};
const BcMore = ({rest, onMore}) => rest > 0 ? (
  <button type="button" className="sl-more" onClick={onMore}>
    Show {Math.min(rest, BC_PAGE)} more<span>{rest} remaining</span>
  </button>
) : null;
// "…" button that opens a small menu of row actions. Keeps rows at one
// width — no reserved space for hidden buttons — and puts each action's
// name in words rather than as an unlabelled icon.
//   items: [{label, icon?, onClick, tone?:'danger', disabled?, sep?:true}]
const BcMenu = ({items, label = 'Actions'}) => {
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null);
  const btnRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const place = React.useCallback(() => {
    const b = btnRef.current; if (!b) return;
    const r = b.getBoundingClientRect();
    const W = 176, H = (menuRef.current && menuRef.current.offsetHeight) || (items.length * 30 + 12);
    const left = Math.max(8, Math.min(r.right - W, window.innerWidth - W - 8));
    const below = r.bottom + 4 + H <= window.innerHeight - 8;
    setPos({ left, top: below ? r.bottom + 4 : Math.max(8, r.top - 4 - H) });
  }, [items.length]);
  React.useLayoutEffect(() => { if (open) place(); }, [open, place]);
  React.useEffect(() => {
    if (!open) return;
    const down = (e) => {
      if (btnRef.current && btnRef.current.contains(e.target)) return;
      if (menuRef.current && menuRef.current.contains(e.target)) return;
      setOpen(false);
    };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); setOpen(false);
      if (btnRef.current) btnRef.current.focus({ preventScroll: true });
    };
    const shut = () => setOpen(false);
    document.addEventListener('mousedown', down, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('resize', shut);
    window.addEventListener('scroll', shut, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('resize', shut);
      window.removeEventListener('scroll', shut, true);
    };
  }, [open]);
  return (
    <>
      <button ref={btnRef} type="button" className="sl-act" aria-label={label} title={label}
        aria-haspopup="menu" aria-expanded={open}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/>
        </svg>
      </button>
      {open && ReactDOM.createPortal(
        <div ref={menuRef} className="sl-menu" role="menu"
          style={pos ? {left: pos.left, top: pos.top} : {visibility: 'hidden', left: 0, top: 0}}
          onClick={e => e.stopPropagation()}>
          {items.filter(Boolean).map((it, i) => it.sep
            ? <div key={'s' + i} className="sl-menu-sep" role="separator"/>
            : (
              <button key={it.label} type="button" role="menuitem" className="sl-menu-item"
                data-tone={it.tone} disabled={!!it.disabled}
                onClick={() => { setOpen(false); if (it.onClick) it.onClick(); }}>
                {it.icon}{it.label}
              </button>
            ))}
        </div>,
        document.body
      )}
    </>
  );
};

// Label / value row for detail pages. `copy` adds a Copy button for IDs,
// addresses and keys; `href` adds a View link (block explorers).
const BcCopy = ({text}) => {
  const [done, setDone] = React.useState(false);
  React.useEffect(() => { if (!done) return; const t = setTimeout(() => setDone(false), 1400); return () => clearTimeout(t); }, [done]);
  if (!text) return null;
  return (
    <button type="button" className="sl-mini" data-done={done ? '1' : undefined}
      onClick={e => { e.stopPropagation(); try { navigator.clipboard.writeText(String(text)); setDone(true); } catch (_) {} }}>
      {done ? 'Copied' : 'Copy'}
    </button>
  );
};
const BcKV = ({k, children, copy, href, mono, title}) => (
  <div className="sl-kv">
    <span className="sl-kv-k">{k}</span>
    <span className="sl-kv-v" title={title}>
      <span className={'sl-kv-text' + (mono ? ' sl-row-mono' : '')}>{children}</span>
      {href && (
        <button type="button" className="sl-mini"
          onClick={e => { e.stopPropagation(); try { window.open(href, '_blank', 'noopener'); } catch (_) {} }}>View</button>
      )}
      {copy && <BcCopy text={copy}/>}
    </span>
  </div>
);
// Short form of a long hash or address: first 8 … last 6.
const bcShort = (v, a = 8, b = 6) => {
  const s = String(v || '');
  return s.length > a + b + 3 ? s.slice(0, a) + '…' + s.slice(-b) : s;
};
// Seconds, milliseconds or a date string → "12 Mar 2026, 14:05".
const bcWhen = (v, withTime = true) => {
  if (v == null || v === '') return '';
  let t = typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(String(v).replace(' ', 'T'));
  if (!isFinite(t)) return String(v);
  const d = new Date(t);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  return withTime ? date + ', ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : date;
};

// Case-insensitive match of a query against any of the given fields.
const bcMatch = (q, ...fields) => {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return true;
  return fields.some(f => f != null && String(f).toLowerCase().includes(needle));
};

// A picture of the outgoing section, laid over the window and faded out.
// A DOM clone rather than a second React render: the sections are whole
// editors (Agents, Catalog, Payments…), and mounting a second copy of one
// just to fade it would refetch, re-initialise and cost a visible stutter.
// Scroll offsets, typed field values and canvas pixels don't survive
// cloneNode, so they're copied across by hand — otherwise the ghost would
// jump to the top of its list in the middle of fading.
const ssetSnapshotPopup = (el) => {
  if (!el || !el.parentNode) return;
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) return;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return;
  // A faster switch than the fade: drop older ghosts instead of stacking.
  el.parentNode.querySelectorAll(':scope > .sset-swap-ghost').forEach(g => g.remove());
  const ghost = el.cloneNode(true);
  ghost.classList.remove('sset-subpop-out');
  ghost.classList.add('sset-swap-ghost');
  ghost.removeAttribute('id');
  ghost.setAttribute('aria-hidden', 'true');
  ghost.removeAttribute('role');
  ghost.removeAttribute('aria-modal');
  const set = (k, v) => ghost.style.setProperty(k, v, 'important');
  set('left', r.left + 'px');
  set('top', r.top + 'px');
  set('width', r.width + 'px');
  set('height', r.height + 'px');
  set('transform', 'none');
  set('margin', '0');
  // Just above the live window (9710 — see the popup z-index layer in
  // BotCommand.html) so the outgoing section actually fades over it.
  set('z-index', '9712');
  // The live window is right underneath with the same frame and shadow;
  // doubling the shadow for the length of the fade would darken the edge.
  set('box-shadow', 'none');
  set('animation', 'sset-swap-ghost-out 190ms cubic-bezier(0.4,0,0.2,1) both');
  // Carry over what cloneNode drops.
  try {
    const src = [el, ...el.querySelectorAll('*')];
    const dst = [ghost, ...ghost.querySelectorAll('*')];
    const scrolls = [];
    for (let i = 0; i < src.length && i < dst.length; i++) {
      const a = src[i], b = dst[i];
      if (a.scrollTop || a.scrollLeft) scrolls.push([b, a.scrollTop, a.scrollLeft]);
      const tag = a.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (a.type === 'checkbox' || a.type === 'radio') b.checked = a.checked;
        else if (a.type !== 'file') b.value = a.value;
      } else if (tag === 'SELECT') {
        b.selectedIndex = a.selectedIndex;
      } else if (tag === 'CANVAS') {
        try { b.getContext('2d').drawImage(a, 0, 0); } catch (_) {}
      }
    }
    el.parentNode.appendChild(ghost);
    scrolls.forEach(([b, t, l]) => { b.scrollTop = t; b.scrollLeft = l; });
  } catch (_) {
    if (!ghost.parentNode) el.parentNode.appendChild(ghost);
  }
  const done = () => { if (ghost.parentNode) ghost.parentNode.removeChild(ghost); };
  ghost.addEventListener('animationend', done, { once: true });
  setTimeout(done, 400);
};

const SettingsSubPanelPopup = ({activeRow, popClosing, tweaks, setTweak, onClose, onPick}) => {
  ensureSsetSwapStyles();
  ensureLandingStyles();
  ensureSettingsDockStyles();
  ensureSsetHeaderStyles();
  // After every other popup stylesheet (views inject theirs on first
  // render, so this re-checks each render and moves itself last if needed).
  React.useLayoutEffect(() => { ensurePopupThemeStyles(); });
  // Closing runs through one path: the settings sheet owns the open row and
  // runs the close — out-animation first, unmount after. This used to ALSO
  // unmount the popup on the spot via onClose, so the sheet's closing state
  // arrived a frame later and remounted it just to play the fade: a blink,
  // then a ghost fading out. onClose is now only a fallback for when no
  // sheet is listening.
  const close = React.useCallback(() => {
    const ev = new CustomEvent('sset:close-popup', { detail: { handled: false } });
    window.dispatchEvent(ev);
    if (!ev.detail.handled && onClose) onClose();
  }, [onClose]);

  // ── Section switch ─────────────────────────────────────────
  // Switching used to clone the whole outgoing section (cloneNode(true) on
  // a full editor, then a walk of every node reading scroll offsets, which
  // forces layout on each one) and fade that copy out over the live window.
  // On the big editors that clone alone cost more than the new section's
  // render and was the stutter felt on every click. Now:
  //   - the switcher circle moves at once (activeRow is urgent state);
  //   - the body follows as a React transition (bodyRow), so the heavy
  //     editor renders in interruptible slices while the old section stays
  //     on screen and responsive, then swaps in with a short opacity fade.
  const [bodyRow, setBodyRow] = React.useState(null);
  const prevBodyRef = React.useRef(null);
  React.useEffect(() => {
    if (!activeRow) { setBodyRow(null); prevBodyRef.current = null; return; }
    const go = () => setBodyRow(activeRow);
    if (typeof React.startTransition === 'function') React.startTransition(go); else go();
  }, [activeRow]);
  // Which page each section is showing. Starts from the page used last
  // time; a request for a specific page (e.g. an old 'payments' id) jumps
  // straight to it.
  const [pageBySec, setPageBySec] = React.useState({});
  const platformsLive = usePlatformsLive();
  const crumb = useSsetCrumbValue();
  const fit = useSsetFitValue();
  // The fixed slot above the window (page tabs or the open item's trail)
  // and, inside it, the node pages portal their tabs into.
  const topRef = React.useRef(null);
  const shapeRef = React.useRef(null);
  const setPortRef = React.useCallback((el) => { SSET_TOP.set(el); }, []);
  const pageFor = (secId) => {
    const sec = SSET_SECTION[secId];
    if (!sec) return null;
    const v = pageBySec[secId];
    return sec.pages.some(p => p.id === v) ? v : readLastPage(secId);
  };
  const selectPage = React.useCallback((secId, pageId) => {
    writeLastPage(secId, pageId);
    setPageBySec(m => (m[secId] === pageId ? m : {...m, [secId]: pageId}));
  }, []);
  React.useEffect(() => {
    const h = (e) => { const d = e && e.detail; if (d && d.section && d.page) selectPage(d.section, d.page); };
    window.addEventListener('sset:goto-page', h);
    return () => window.removeEventListener('sset:goto-page', h);
  }, [selectPage]);
  const shownRowNow = bodyRow || activeRow || null;
  const bodyKey = shownRowNow ? shownRowNow + ':' + pageFor(shownRowNow) : null;
  // Remember what was on screen once it has actually committed (a transition
  // render can be thrown away and redone, so this is not done in render).
  React.useEffect(() => { prevBodyRef.current = bodyKey; });
  // Tell the stylesheet a section window is up (and which one), so the app
  // background can hold still behind it. Its animation forced the window's
  // backdrop blur to be recomputed on every single frame.
  React.useEffect(() => {
    const root = document.documentElement;
    if (activeRow && !popClosing) { root.setAttribute('data-sset-open', '1'); root.setAttribute('data-sset-pop', activeRow); }
    else { root.removeAttribute('data-sset-open'); root.removeAttribute('data-sset-pop'); }
  }, [activeRow, popClosing]);
  React.useEffect(() => () => {
    try { document.documentElement.removeAttribute('data-sset-open'); document.documentElement.removeAttribute('data-sset-pop'); } catch (_) {}
  }, []);
  // ── Drag to move, grip to resize ────────────────────────────
  const popRef  = React.useRef(null);
  const dragRef = React.useRef(null);
  // Position: session-only. null means "let the CSS centre me", which is
  // the state every fresh mount (and therefore every refresh) starts in.
  const [geom, setGeom] = React.useState(null);
  // Size: the one piece of window geometry that survives a reload.
  const [size, setSize] = React.useState(readPopSize);
  const geomRef = React.useRef(null);
  geomRef.current = geom;

  // ── Section switcher placement ──────────────────────────────
  // The circles sit outside the window (which clips its own contents), so
  // they are a sibling positioned against it. Written straight to the
  // element — no state, no render — from the same places that move or size
  // the window, so the two never drift apart, even mid-drag.
  const swRef = React.useRef(null);
  // Also places the top tab's slot: standing on the window's top edge,
  // its left shoulder starting on the content gutter.
  const placeSwitcher = React.useCallback(() => {
    const el = popRef.current, sw = swRef.current, cr = topRef.current;
    if (!el || (!sw && !cr)) return;
    const d = dragRef.current;
    // The tab (with both shoulders) stays on the straight part of the
    // window's top edge, clear of the rounded corners.
    if (cr) cr.style.maxWidth = Math.max(120, (d ? d.curW : el.offsetWidth) - 2 * SSET_TAB_X) + 'px';
    let left = null, top = null;
    if (d && d.mode === 'move') { left = d.curLeft; top = d.curTop; }
    else if (d && !d.centred)   { left = d.left;    top = d.top; }
    else if (!d && geomRef.current) { left = geomRef.current.left; top = geomRef.current.top; }
    if (left != null) {
      if (sw) { sw.style.left = (left - SSET_SW_SPACE) + 'px'; sw.style.top = top + 'px'; }
      if (cr) { cr.style.left = (left + SSET_TAB_X) + 'px'; cr.style.top = (top - SSET_TOP_SPACE) + 'px'; }
    } else {
      // Centred: the window is left 50% pulled back by half its own width,
      // and hung from --sset-top (which doesn't depend on its height), so
      // its top-left corner is exactly this — whatever its height.
      const w = d ? d.curW : el.offsetWidth;
      if (sw) { sw.style.left = `calc(50% - ${w / 2 + SSET_SW_SPACE}px)`; sw.style.top = 'var(--sset-top)'; }
      if (cr) { cr.style.left = `calc(50% - ${w / 2 - SSET_TAB_X}px)`; cr.style.top = `calc(var(--sset-top) - ${SSET_TOP_SPACE}px)`; }
    }
  }, []);

  // Freeze the current on-screen rect before the first drag so moving
  // doesn't fight the translate-centring the CSS uses by default.
  const currentRect = () => {
    const el = popRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  };

  const startDrag = (mode) => (e) => {
    if (e.button !== 0) return;
    if (mode === 'move' && e.target.closest && e.target.closest('button, input, select, a')) return;
    const r = currentRect();
    if (!r) return;
    // Resizing a still-centred window keeps it centred across and hung
    // from the same top line — it grows sideways from the middle and
    // downwards from the top. Only a deliberate move pins the window to
    // coordinates, and even that lasts just for this session.
    const centred = (mode === 'size') && !geom;
    dragRef.current = {
      mode, centred, sx: e.clientX, sy: e.clientY, ...r,
      // Live values, updated per frame and committed to state on release.
      curLeft: r.left, curTop: r.top, curW: r.w, curH: r.h,
      x: e.clientX, y: e.clientY, raf: 0,
      prevUserSelect: document.body.style.userSelect,
    };
    if (!centred) setGeom(r);
    // Every field, label and embedded editor inside the popup would
    // otherwise be selected as the pointer sweeps across them.
    document.body.style.userSelect = 'none';
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch (_) {}
    e.preventDefault();
    e.stopPropagation();
  };

  // The geometry is written straight to the element while the drag runs and
  // only committed to React state when the pointer is released.
  //
  // The popup hosts whole editors — Agents, Catalog, Licenses, Payments —
  // as its body. Calling setGeom()/setSize() from the move handler re-ran
  // all of that on every pointer event, and a mouse reports several times
  // per frame, so the window arrived a long way behind the cursor and in
  // visible steps. Nothing about the styling changes: these are the same
  // four properties React was setting, set on the same element, just at
  // screen rate and without a render behind each one.
  const applyDragFrame = React.useCallback(() => {
    const d = dragRef.current;
    if (!d) return;
    d.raf = 0;
    const el = popRef.current;
    if (!el) return;
    const dx = d.x - d.sx, dy = d.y - d.sy;
    if (d.mode === 'move') {
      const minLeft = 8 + SSET_SW_SPACE;   // room for the section circles
      const maxLeft = Math.max(minLeft, window.innerWidth  - d.w - 8);
      // …and room above for the top pill.
      const maxTop  = Math.max(SSET_TOP_MIN, window.innerHeight - d.h - 8);
      d.curLeft = Math.min(Math.max(minLeft, d.left + dx), maxLeft);
      d.curTop  = Math.min(Math.max(SSET_TOP_MIN, d.top  + dy), maxTop);
      el.style.left = d.curLeft + 'px';
      el.style.top  = d.curTop  + 'px';
    } else if (d.centred) {
      // Centred across: both side edges move outward, so the width grows by
      // twice the pointer delta for the grip to stay under the cursor. The
      // top edge is fixed (--sset-top), so the height follows it 1:1.
      d.curW = Math.round(Math.min(Math.max(POP_MIN_W, d.w + dx * 2), POP_MAX_W, window.innerWidth  - 48 - SSET_SW_SPACE * 2));
      d.curH = Math.round(Math.min(Math.max(POP_MIN_H, d.h + dy), POP_MAX_H, window.innerHeight - d.top - 16));
      el.style.width  = d.curW + 'px';
      el.style.height = d.curH + 'px';
    } else {
      d.curW = Math.round(Math.min(Math.max(POP_MIN_W, d.w + dx), POP_MAX_W, window.innerWidth  - d.left - 8));
      d.curH = Math.round(Math.min(Math.max(POP_MIN_H, d.h + dy), POP_MAX_H, window.innerHeight - d.top  - 8));
      el.style.width  = d.curW + 'px';
      el.style.height = d.curH + 'px';
    }
    placeSwitcher();
  }, [placeSwitcher]);

  React.useEffect(()=>{
    const onMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      d.x = e.clientX; d.y = e.clientY;
      if (d.raf) return;                    // a frame is already queued
      d.raf = requestAnimationFrame(applyDragFrame);
    };
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      if (d.raf) { cancelAnimationFrame(d.raf); d.raf = 0; }
      applyDragFrame();                     // settle on the final pointer position
      dragRef.current = null;
      document.body.style.userSelect = d.prevUserSelect || '';
      // Hand the final geometry to React in one commit, so the element's
      // inline styles and the state that owns them agree again.
      if (d.mode === 'move') {
        setGeom({left: d.curLeft, top: d.curTop, w: d.w, h: d.h});
      } else if (d.centred) {
        setSize({w: d.curW, h: d.curH});
      } else {
        setGeom({left: d.left, top: d.top, w: d.curW, h: d.curH});
        setSize({w: d.curW, h: d.curH});
      }
      // Only the size is written back — the position deliberately dies with
      // the session so the next open is centred again.
      if (d.mode !== 'move') writePopSize({w: d.curW, h: d.curH});
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return ()=>{
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      if (dragRef.current) {
        if (dragRef.current.raf) cancelAnimationFrame(dragRef.current.raf);
        document.body.style.userSelect = dragRef.current.prevUserSelect || '';
        dragRef.current = null;
      }
    };
  },[applyDragFrame]);

  // A render that lands mid-drag (the store notifying, a field inside the
  // popup updating) would reapply the inline styles from state, which is a
  // frame or more behind the pointer — the window would jump backwards and
  // then catch up. Re-assert the live geometry after every commit while a
  // drag is in flight.
  React.useLayoutEffect(() => {
    const d = dragRef.current;
    const el = popRef.current;
    if (!d || !el) return;
    if (d.mode === 'move') {
      el.style.left = d.curLeft + 'px';
      el.style.top  = d.curTop  + 'px';
    } else {
      el.style.width  = d.curW + 'px';
      el.style.height = d.curH + 'px';
    }
    placeSwitcher();
  });

  // Place the circles before the first paint, whenever the committed
  // geometry changes, and whenever the window's box changes size for any
  // other reason (viewport height, min/max clamps).
  React.useLayoutEffect(() => { placeSwitcher(); }, [placeSwitcher, geom, size, activeRow, crumb]);

  // The tab's glass follows the row in it: row width plus both shoulders.
  // Written straight to the element from a ResizeObserver (which runs
  // before paint), and eased by CSS, so changing rows morphs the tab. The
  // first fit — and a fit after the tab was empty — is instant.
  React.useLayoutEffect(() => {
    const slot = topRef.current, sh = shapeRef.current;
    if (!slot || !sh) return;
    let raf = 0;
    const fit = () => {
      const w = slot.offsetWidth;
      if (w < 1) { sh.setAttribute('data-empty', '1'); return; }
      const wasEmpty = sh.getAttribute('data-empty') === '1';
      if (wasEmpty) {
        sh.setAttribute('data-instant', '1');
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => sh.removeAttribute('data-instant')); });
      }
      sh.style.width = (w + 2 * SSET_TAB_R) + 'px';
      sh.removeAttribute('data-empty');
    };
    fit();
    if (typeof ResizeObserver === 'undefined') return () => cancelAnimationFrame(raf);
    const ro = new ResizeObserver(fit);
    ro.observe(slot);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, [!!activeRow]);

  // The top pill's glass (not its buttons) is a drag handle too, and a
  // double-click on it re-centres, like the window's own grab strip.
  // Native listeners: page tabs are portalled into the slot, and React
  // bubbles a portal's events through the page, not through the slot.
  const startDragRef = React.useRef(null);
  startDragRef.current = startDrag;
  const resetGeomRef = React.useRef(null);
  React.useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const onGlass = (e) => {
      const t = e.target;
      return !!(t && t.closest && !t.closest('button') && t.closest('.sset-tp, .sset-crumb, .sset-top-shape'));
    };
    const down = (e) => { if (onGlass(e) && startDragRef.current) startDragRef.current('move')(e); };
    const dbl  = (e) => { if (onGlass(e) && resetGeomRef.current) resetGeomRef.current(); };
    el.addEventListener('pointerdown', down);
    el.addEventListener('dblclick', dbl);
    return () => { el.removeEventListener('pointerdown', down); el.removeEventListener('dblclick', dbl); };
  }, [!!activeRow]);
  React.useLayoutEffect(() => {
    const el = popRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => { if (!dragRef.current) placeSwitcher(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [placeSwitcher, !!activeRow]);

  // The browser window changed size: put the popup back in the centre.
  // A position the window was dragged to belongs to the old viewport, so
  // it is dropped (the CSS centres the window again, and the section
  // circles and top tab follow it); a resized window keeps its size,
  // shrunk only as far as the new viewport needs.
  React.useEffect(()=>{
    let raf = 0;
    const onResize = () => {
      if (dragRef.current) return;          // mid-drag: the drag owns the geometry
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setSize(s => s ? {
          w: Math.min(s.w, Math.max(POP_MIN_W, window.innerWidth  - 48 - SSET_SW_SPACE * 2)),
          h: Math.min(s.h, Math.max(POP_MIN_H, window.innerHeight - 48 - SSET_TOP_SPACE)),
        } : s);
        setGeom(g => (g ? null : g));
        placeSwitcher();
      });
    };
    window.addEventListener('resize', onResize);
    return ()=>{ window.removeEventListener('resize', onResize); cancelAnimationFrame(raf); };
  },[placeSwitcher]);

  // Leaving a setup wizard: a window moved while it was up recorded the
  // wizard's own (content) height. Give it back its normal height.
  const fitWasRef = React.useRef(fit);
  React.useEffect(() => {
    if (fitWasRef.current && !fit) {
      setGeom(g => g ? {
        ...g,
        h: Math.max(POP_MIN_H, Math.min((size && size.h) || POP_DEFAULT_H, window.innerHeight - g.top - 8)),
      } : g);
    }
    fitWasRef.current = fit;
  }, [fit]);

  // Double-click the grab strip: back to dead centre at the shipped size.
  const resetGeom = () => { setGeom(null); setSize(null); clearPopSize(); };
  resetGeomRef.current = resetGeom;

  React.useEffect(()=>{
    const h = e => {
      if (e.key !== 'Escape') return;
      // Esc in a filled search field clears the search instead of closing.
      const t = e.target;
      if (t && t.tagName === 'INPUT' && t.type === 'search' && t.value) return;
      // An open row menu closes first; the window stays.
      if (document.querySelector('.sl-menu')) return;
      e.stopPropagation(); close();
    };
    window.addEventListener('keydown', h, true);
    return ()=>window.removeEventListener('keydown', h, true);
  }, [close]);

  // Clicking the section already showing does nothing (it must not close
  // the window); nothing is clickable while the window is closing.
  const selectSection = React.useCallback((id) => {
    if (!id || id === activeRow || popClosing || !onPick) return;
    onPick(id);
  }, [activeRow, popClosing, onPick]);

  if (!activeRow) return null;

  // Each page is its own panel; the forms themselves are unchanged. Pages
  // that are only a scrolling body get the page column (.sset-pop-page)
  // around them so they fill the window the same way the editors do. It is
  // plain markup, not a component declared here: a component created during
  // render would be a new type every time and remount the form under it.
  const renderSubPanel = (pageId) => {
    switch (pageId) {
      case 'apps':
      case 'ai':
      case 'filters':       return <SS_Connections/>;
      case 'agents':        return <SS_Embed><AgentsView _embed/></SS_Embed>;
      case 'catalog':       return <SS_Embed><ProductsView _embed/></SS_Embed>;
      case 'billing':       return <SS_Embed><BillingView/></SS_Embed>;
      case 'licenses':      return <SS_Embed><LicensesView _embed/></SS_Embed>;
      case 'payments':      return <SS_Embed><PaymentsView _embed/></SS_Embed>;
      case 'appearance':    return <div className="sset-pop-page"><SS_Appearance tweaks={tweaks} setTweak={setTweak}/></div>;
      case 'notifications': return <div className="sset-pop-page"><SS_Notifications/></div>;
      default:              return <div style={{padding:20,color:'#8a8aa8'}}>Unknown page</div>;
    }
  };

  const sec = SSET_SECTION[activeRow] || {id:activeRow, label:'Settings', pages:[]};
  const tall = POPUP_TALL.has(activeRow);
  // The body may be a frame behind the switcher while a heavy editor
  // renders (see bodyRow above).
  const shownRow = shownRowNow;
  const shownPage = pageFor(shownRow);
  // The top pill follows the BODY (like the trail and the portalled page
  // tabs do), not the switcher: while a heavy section is still rendering,
  // the old body — and its pill — stay up together, so two pills are never
  // on screen at once.
  const shownSec = SSET_SECTION[shownRow] || sec;
  const shownMulti = shownSec.pages.length > 1;
  // Fade only when one page replaces another, not on the first open
  // (the window's own entrance already covers that).
  const swapIn = !!(prevBodyRef.current && prevBodyRef.current !== bodyKey);

  // Glyph for the open item's list, from the trail's parent name.
  const crumbIco = crumb ? (SSET_CRUMB_ICON[String(crumb.parent || '').toLowerCase()] || null) : null;

  return (
    <>
      <div
        className={`sset-pop-backdrop${popClosing?' sset-pop-backdrop-out':''}`}
        onClick={close}
      />
      {/* Not keyed by section: switching sections keeps this one window in
          place (same frame, same position, same size) and swaps only its
          body — see ssetSnapshotPopup. */}
      <aside
        ref={popRef}
        className={`sset-subpop${popClosing?' sset-subpop-out':''}`}
        data-pop={shownPage || activeRow}
        data-section={activeRow}
        data-tall={tall ? '1' : undefined}
        data-moved={geom ? '1' : undefined}
        data-focus={crumb ? '1' : undefined}
        data-fit={fit ? '1' : undefined}
        style={fit
          // Setup wizard: width as usual, height follows the step. A moved
          // window keeps its top edge and may grow down to the viewport.
          ? (geom ? {left:geom.left, top:geom.top, width:geom.w, maxHeight:`calc(100vh - ${geom.top + 8}px)`}
                  : (size ? {width:size.w} : undefined))
          : geom
          ? {left:geom.left, top:geom.top, width:geom.w, height:geom.h}
          : (size ? {width:size.w, height:size.h} : undefined)}
        role="dialog"
        aria-modal="true"
        aria-label={sec.label}
        onClick={e=>e.stopPropagation()}
      >
        <span className="sset-pop-grab" aria-hidden="true"
          onPointerDown={startDrag('move')}
          onDoubleClick={resetGeom}/>

        {/* Page tabs are no longer drawn inside the window: they are the
            symbol pill in the top slot (below), so every page starts on
            the same line under the window's edge. */}

        <div key={bodyKey}
          className={`sset-subpop-body${swapIn ? ' sset-body-swapin' : ''}`}
          onAnimationEnd={(e) => {
            if (e.target === e.currentTarget) e.currentTarget.classList.remove('sset-body-swapin');
          }}>
          {renderSubPanel(shownPage)}
        </div>

        <span className="sset-pop-resize" onPointerDown={startDrag('size')} title="Drag to resize"/>
      </aside>

      {/* Section circles, docked to the window's left edge. They step
          aside while an item is open, like the page tabs. */}
      <SettingsSwitcher swRef={swRef} activeRow={activeRow} closing={popClosing} focus={!!crumb} onSelect={selectSection} onClose={close}/>

      {/* The top slot, docked above the window. Holds one pill: the open
          item's trail if there is one, else this section's pages
          (Preferences), else whatever the page portals in (the tabs of
          Agents, Catalog and Licenses & payments). Always mounted while
          the window is, so it never has to be re-placed. */}
      <div ref={topRef} className="sset-top" data-out={popClosing ? '1' : undefined}
        onClick={e => e.stopPropagation()}>
        <div ref={shapeRef} className="sset-top-shape" data-empty="1" aria-hidden="true">
          <span className="sset-top-line"/>
        </div>
        {/* Phones only (see SETTINGS ON A PHONE): the section's name. An open
            item's trail carries its own title instead. */}
        {!crumb && <span className="sset-top-title" aria-hidden="true">{sec.label}</span>}
        {crumb ? (
          <nav className="sset-crumb" aria-label="Current item">
            <button type="button" className="sset-crumb-back" onClick={crumb.back}
              aria-label={`Back to ${crumb.parent}`} data-tip={crumb.parent}
              onMouseDown={e => e.preventDefault()}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9"
                strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>
            </button>
            <span className="sset-crumb-sep" aria-hidden="true"/>
            {crumbIco && <span className="sset-crumb-ico" aria-hidden="true">{crumbIco}</span>}
            <span className="sset-crumb-title" title={crumb.title}>{crumb.title}</span>
          </nav>
        ) : shownMulti ? (
          <SsetTopTabs label={`${shownSec.label} pages`} value={shownPage}
            onChange={(id) => selectPage(shownRow, id)}
            tabs={shownSec.pages.map(pg => ({id: pg.id, label: pg.label,
              dot: pg.id === 'apps' && platformsLive ? 'ok' : undefined}))}/>
        ) : null}
        <div ref={setPortRef} className="sset-top-port"/>
        {/* Phones only: on a phone the dashboard (and its earnings chip)
            isn't on screen, so Payments carries the way in. */}
        {!crumb && sec.id === 'billing' && typeof window.ProfitBubble === 'function' && (
          <span className="sset-top-wallet">{React.createElement(window.ProfitBubble, { sheet: true })}</span>
        )}
      </div>

    </>
  );
};

// ── Diagnostic status pill (.NET host) ───────────────────────
// Tiny pill that lives in the sub-popup header. Replaces the old
// full-width banner. Click to send a ping; tooltip on hover shows the
// last result. Falls back to a "warn" state when WebView2 is absent.
const DiagPill = () => {
  const [pingState, setPingState] = React.useState(''); // '' | 'sent' | 'ok' | 'fail'
  const bridge = window.BotBridge;
  const isWV2  = bridge && bridge.isWebView2 && bridge.isWebView2();
  React.useEffect(()=>{
    const h = e => {
      if (e.detail && e.detail.event === 'pong') {
        setPingState('ok');
        setTimeout(()=>setPingState(''), 2400);
      }
    };
    window.addEventListener('bcEvent', h);
    return ()=>window.removeEventListener('bcEvent', h);
  },[]);
  const onClick = (e) => {
    e.stopPropagation();
    if (!isWV2) return;
    setPingState('sent');
    if (bridge && bridge.ping) bridge.ping();
    setTimeout(()=>setPingState(s => s==='sent' ? 'fail' : s), 3000);
  };
  const label = !isWV2 ? 'Browser'
              : pingState === 'sent' ? 'Pinging…'
              : pingState === 'ok'   ? '.NET ✓'
              : pingState === 'fail' ? 'No reply'
              : '.NET';
  return (
    <button className="sset-diag-pill" data-state={isWV2 ? 'ok' : 'warn'}
      onClick={onClick} title={isWV2 ? 'Click to ping .NET host' : 'Running in browser — bridge inactive'}>
      <span className="sset-diag-dot"/>
      <span>{label}</span>
    </button>
  );
};

// ── Info icon (?) with hover tooltip ─────────────────────────
// Replaces long <SNote> paragraphs with on-demand help. Tooltip is
// portalled into document.body and positioned with fixed coords so it
// can escape any ancestor with overflow:hidden/auto (like .sset-subpop).
const SsetInfo = ({children}) => {
  const triggerRef = React.useRef(null);
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState({left:0, top:0});
  const TIP_W = 240;

  const updatePos = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    // Right-align the tip with the trigger; clamp to viewport with 8px pad.
    let left = r.right - TIP_W;
    if (left < 8) left = 8;
    if (left + TIP_W > window.innerWidth - 8) left = window.innerWidth - TIP_W - 8;
    setPos({ left, top: r.bottom + 6 });
  };

  React.useEffect(()=>{
    if (!open) return;
    updatePos();
    const h = ()=>updatePos();
    window.addEventListener('scroll', h, true);
    window.addEventListener('resize', h);
    return ()=>{
      window.removeEventListener('scroll', h, true);
      window.removeEventListener('resize', h);
    };
  // eslint-disable-next-line
  },[open]);

  return (
    <>
      <span ref={triggerRef} className="sset-info" tabIndex={0}
        onMouseEnter={()=>setOpen(true)} onMouseLeave={()=>setOpen(false)}
        onFocus={()=>setOpen(true)} onBlur={()=>setOpen(false)}>?</span>
      {open && ReactDOM.createPortal(
        <span className="sset-info-tip sset-info-tip-portal"
          style={{left: pos.left, top: pos.top, width: TIP_W}}>
          {children}
        </span>,
        document.body
      )}
    </>
  );
};

// ── Sliding-pill segmented control ───────────────────────────
// Premium replacement for .sset-segmented; the active background
// animates between options instead of swapping.
const SsetSeg = ({value, onChange, options}) => {
  const refs = React.useRef({});
  const [thumb, setThumb] = React.useState({left:3, width:0});
  const containerRef = React.useRef(null);
  React.useLayoutEffect(()=>{
    const btn = refs.current[value];
    const cont = containerRef.current;
    if (!btn || !cont) return;
    const cb = cont.getBoundingClientRect();
    const bb = btn.getBoundingClientRect();
    setThumb({ left: bb.left - cb.left, width: bb.width });
  }, [value, options.length]);
  return (
    <div className="sset-seg2" ref={containerRef}>
      <span className="sset-seg2-thumb" style={{left:thumb.left, width:thumb.width}}/>
      {options.map(o => (
        <button key={o.id}
          ref={el=>{ if(el) refs.current[o.id]=el; }}
          className="sset-seg2-btn"
          data-on={value===o.id?'1':'0'}
          onClick={()=>onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
};

// ── SETTINGS SHEET — embed wrapper ────────────────────────────
// Wraps an existing full-page view (AgentsView, ProductsView, etc) so it
// renders inside the sheet without its outer page padding looking weird.
// The "sset-embed" CSS rule trims the inner padding and forces a single
// column layout when the sheet is narrow (which it usually is).
const SS_Embed = ({children}) => (
  <div className="sset-embed">{children}</div>
);

// ── SETTINGS SHEET — Platforms (Telegram + Discord) ───────────
// Completely rewritten: tab strip, multi-account connected cards,
// add-account forms (Bot API + User API), and a live connection log.
// Self-contained — does NOT nest SettingsView inside.
const SS_Platforms = ({platform, bare} = {}) => {
  const [tab, setTab] = React.useState(platform || 'telegram');
  const [tgMode, setTgMode] = React.useState('bot');
  const [tgConn, dcConn] = useConn();
  const connLog = useConnLog ? useConnLog() : [];
  const creds = useCreds();
  const bridge = window.BotBridge;
  const isWV2 = !!(bridge && bridge.isWebView2 && bridge.isWebView2());
  // Without the desktop app, bot tokens are run by the server (BC_RELAY);
  // a personal Telegram account (the User API) can't be.
  useRelay();
  const [relayErr, setRelayErr] = React.useState({ telegram: '', discord: '' });

  const [fld, setFld] = React.useState({
    tgToken:'', tgApiId:'', tgApiHash:'', tgPhone:'',
    dc:'',
  });
  const [tgBusy, setTgBusy] = React.useState(false);
  const [dcBusy, setDcBusy] = React.useState(false);
  // Diagnostics are collapsed by default so the panel opens clean.
  const [logOpen, setLogOpen] = React.useState(false);

  // Hydrate fields from persisted creds
  React.useEffect(() => {
    setFld(prev => ({
      tgToken:   prev.tgToken   || creds.values.tg_bot_token || '',
      tgApiId:   prev.tgApiId   || creds.values.tg_api_id    || '',
      tgApiHash: prev.tgApiHash || creds.values.tg_api_hash  || '',
      tgPhone:   prev.tgPhone   || creds.values.tg_phone     || '',
      dc:        prev.dc        || creds.values.dc_bot_token  || '',
    }));
  }, [creds.loaded]);

  // Reconnection + auto-login on boot are handled by the always-on supervisor
  // at the app root (works whether or not this panel is open).
  const sv = (k, v) => { setFld(f => ({ ...f, [k]: v })); };

  // ── Multi-account state ──────────────────────────────────────
  const accts = usePlatformAccounts();
  const tgList = accts.list('telegram');
  const dcList = accts.list('discord');
  const tgActiveId = accts.activeId('telegram');
  const dcActiveId = accts.activeId('discord');
  // Which account (if any) is currently being added/edited. null = none,
  // 'new' = add form, otherwise an account id being edited.
  const [tgEditing, setTgEditing] = React.useState(null);
  const [dcEditing, setDcEditing] = React.useState(null);

  const blankTgFields = () => setFld(f => ({ ...f, tgToken:'', tgApiId:'', tgApiHash:'', tgPhone:'' }));

  const startAddTg = () => { blankTgFields(); setTgMode('bot'); setTgEditing('new'); };
  const startAddDc = () => { setFld(f => ({ ...f, dc:'' })); setDcEditing('new'); };

  const startEditTg = (a) => {
    setTgMode(a.mode || 'bot');
    setFld(f => ({ ...f,
      tgToken:   a.token  || '',
      tgApiId:   a.apiId  || '',
      tgApiHash: a.apiHash|| '',
      tgPhone:   a.phone  || '' }));
    setTgEditing(a.id);
  };
  const startEditDc = (a) => { setFld(f => ({ ...f, dc: a.token || '' })); setDcEditing(a.id); };

  // Save the add/edit form into PLATFORM_ACCOUNTS. When thenConnect is true,
  // immediately connect the saved account.
  const saveTgAccount = (thenConnect) => {
    const payload = tgMode === 'bot'
      ? { mode:'bot',  label: 'Telegram bot', token:(fld.tgToken||'').trim() }
      : { mode:'user', label: (fld.tgPhone || '').trim() || 'Personal account', apiId:(fld.tgApiId||'').trim(), apiHash:(fld.tgApiHash||'').trim(), phone:(fld.tgPhone||'').trim() };
    if (tgMode === 'bot' && !payload.token) return;
    if (tgMode === 'user' && (!payload.apiId || !payload.apiHash || !payload.phone)) return;
    let row;
    if (tgEditing && tgEditing !== 'new') { PLATFORM_ACCOUNTS.update('telegram', tgEditing, payload); row = { id: tgEditing, ...payload }; }
    else { row = PLATFORM_ACCOUNTS.add('telegram', payload); }
    setTgEditing(null);
    if (thenConnect) connectTgAccount(row);
  };
  const saveDcAccount = (thenConnect) => {
    const token = (fld.dc || '').trim();
    if (!token) return;
    const payload = { label: 'Discord bot', token };
    let row;
    if (dcEditing && dcEditing !== 'new') { PLATFORM_ACCOUNTS.update('discord', dcEditing, payload); row = { id: dcEditing, ...payload }; }
    else { row = PLATFORM_ACCOUNTS.add('discord', payload); }
    setDcEditing(null);
    if (thenConnect) connectDcAccount(row);
  };

  // Connect a specific saved account. Mirrors its creds into the legacy keys
  // (the .NET host + supervisor + backend read those) and issues the connect.
  // The .NET host runs one live client per platform, so this transparently
  // switches the active account.
  // In a browser: the server checks the token and starts answering.
  const connectViaServer = (p, a, setBusy) => {
    PLATFORM_ACCOUNTS.setActive(p, a.id);
    PLATFORM_ACCOUNTS.mirrorToLegacy(p, a.id);
    setBusy(true);
    setRelayErr(e => ({ ...e, [p]: '' }));
    BC_RELAY.connect(p, a.token || '').then(r => {
      setBusy(false);
      if (r && r.ok) {
        const s = (r.relays && r.relays[p]) || {};
        CONN_STORE.addLog(p, 'ok', 'Running on the server' + (s.username ? ' as @' + s.username : ''));
      } else {
        const why = (r && r.error) || 'Couldn’t connect.';
        setRelayErr(e => ({ ...e, [p]: why }));
        CONN_STORE.addLog(p, 'error', why);
      }
    });
  };
  const connectTgAccount = (a) => {
    if (!a) return;
    if (!isWV2) { if (a.mode === 'bot') connectViaServer('telegram', a, setTgBusy); return; }
    CONN_SUPPRESS.telegram = false;
    PLATFORM_ACCOUNTS.setActive('telegram', a.id);
    PLATFORM_ACCOUNTS.mirrorToLegacy('telegram', a.id);
    setTgBusy(true);
    CONN_STORE.set('telegram', { error:'' });
    if (a.mode === 'bot') bridge.connectTelegram(a.token || '');
    else bridge.connectTelegramUser(a.apiId || '', a.apiHash || '', a.phone || '');
  };
  const connectDcAccount = (a) => {
    if (!a) return;
    if (!isWV2) { connectViaServer('discord', a, setDcBusy); return; }
    CONN_SUPPRESS.discord = false;
    PLATFORM_ACCOUNTS.setActive('discord', a.id);
    PLATFORM_ACCOUNTS.mirrorToLegacy('discord', a.id);
    setDcBusy(true);
    CONN_STORE.set('discord', { error:'' });
    bridge.connectDiscord(a.token || '');
  };

  // Disconnecting also stops the server answering the bot (it would
  // otherwise take over once the desktop app closes).
  const disconnectTg = () => {
    CONN_SUPPRESS.telegram = true; setTgBusy(false);
    if (isWV2) bridge.disconnectTelegram();
    BC_RELAY.disconnect('telegram');
    CONN_STORE.set('telegram', { connected:false, botName:'', username:'', botId:'', avatar:'', error:'' });
  };
  const disconnectDc = () => {
    CONN_SUPPRESS.discord = true; setDcBusy(false);
    if (isWV2) bridge.disconnectDiscord();
    BC_RELAY.disconnect('discord');
    CONN_STORE.set('discord', { connected:false, botName:'', username:'', botId:'', avatar:'', error:'' });
  };

  const removeTgAccount = (a) => {
    if (tgActiveId === a.id && tgConn.connected) disconnectTg();
    PLATFORM_ACCOUNTS.remove('telegram', a.id);
    if (tgEditing === a.id) setTgEditing(null);
  };
  const removeDcAccount = (a) => {
    if (dcActiveId === a.id && dcConn.connected) disconnectDc();
    PLATFORM_ACCOUNTS.remove('discord', a.id);
    if (dcEditing === a.id) setDcEditing(null);
  };

  // Clear busy state when status updates
  React.useEffect(() => { if (tgConn.connected || tgConn.error) setTgBusy(false); }, [tgConn.connected, tgConn.error]);
  React.useEffect(() => { if (dcConn.connected || dcConn.error) setDcBusy(false); }, [dcConn.connected, dcConn.error]);

  // Platform-filtered log
  const platformLog = React.useMemo(() => {
    const filtered = connLog.filter(e => e.platform === tab);
    return filtered.slice(-25).reverse();  // newest first, max 25 shown
  }, [connLog, tab]);

  const fmtTs = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' });
  };

  const TABS = [
    {id:'telegram', label:'Telegram', icon:<TgIcon s={12}/>, live:!!tgConn.connected, count:tgList.length},
    {id:'discord',  label:'Discord',  icon:<DcIcon s={12}/>, live:!!dcConn.connected, count:dcList.length},
  ];

  // ── Saved-account row ────────────────────────────────────────
  // Status first, actions second. Edit/Remove stay hidden until hover so
  // a connected account reads as a calm status line.
  const AcctRow = ({live, busy, name, meta, onConnect, onDisconnect, onEdit, onRemove, anyBusy, needsDesktop}) => (
    <div className="sset-acct" data-live={live?'1':'0'}>
      <Pip col={live?'var(--ok)':(busy?'var(--warn,#e8a844)':'var(--t4)')} sz={7} pulse={live||busy}/>
      <div className="sset-acct-text">
        <div className="sset-acct-name">{name}</div>
        <div className="sset-acct-meta">{meta}</div>
      </div>
      <div className="sset-acct-acts">
        <button className="sset-btn sset-btn-icon sset-acct-secondary" onClick={onEdit} title="Edit account" aria-label="Edit account">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </button>
        <button className="sset-btn sset-btn-icon sset-acct-secondary" onClick={onRemove} title="Remove account" aria-label="Remove account">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </button>
        {live ? (
          <button className="sset-btn" data-variant="danger" onClick={onDisconnect}>Disconnect</button>
        ) : (
          <button className="sset-btn" data-variant="primary" onClick={onConnect}
            disabled={(needsDesktop && !isWV2) || anyBusy}
            title={needsDesktop && !isWV2 ? 'Needs the desktop app' : undefined}>
            {busy ? 'Connecting…' : 'Connect'}
          </button>
        )}
      </div>
    </div>
  );

  // One quiet line on where the bot runs. In a browser: bots run on the
  // server, a personal account needs the desktop app. In the desktop app,
  // once a bot is connected: it keeps answering after the app is closed.
  const RunsWhere = ({p, live}) => {
    const txt = !isWV2
      ? (p === 'telegram' ? 'In the browser, bots run on our server. Personal accounts need the desktop app.' : 'In the browser, bots run on our server.')
      : (live && (p === 'discord' || (PLATFORM_ACCOUNTS.get('telegram', tgActiveId) || {}).mode !== 'user') ? 'Keeps replying from the server while this app is closed.' : '');
    return txt ? <div className="sset-form-hint sset-runs-where">{txt}</div> : null;
  };

  // ── Collapsible diagnostics ──────────────────────────────────
  const LogPanel = () => (
    <div className="sset-disclose" data-open={logOpen?'1':'0'}>
      <button className="sset-disclose-head" onClick={()=>setLogOpen(o=>!o)}>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span>Activity log</span>
        <span style={{flex:1}}/>
        {logOpen && platformLog.length > 0 && (
          <span onClick={e=>{ e.stopPropagation(); if (CONN_STORE.clearLog) CONN_STORE.clearLog(); }}
            style={{fontSize:10,textTransform:'none',letterSpacing:0,color:'#8a8aa8',fontWeight:500}}>Clear</span>
        )}
      </button>
      {logOpen && (
        <div className="sset-log">
          {platformLog.length === 0 && <span style={{color:'#8a8aa8',fontStyle:'italic'}}>No events yet</span>}
          {platformLog.map((entry, i) => {
            const col = entry.level === 'ok' ? 'var(--ok)'
                      : entry.level === 'error' ? 'var(--err)'
                      : entry.level === 'warn' ? 'var(--warn)'
                      : 'var(--t3)';
            const prefix = entry.level === 'ok' ? '✓' : entry.level === 'error' ? '✕' : entry.level === 'warn' ? '⚠' : '·';
            return (
              <div className="sset-log-row" key={i}>
                <span className="sset-log-ts">{fmtTs(entry.ts)}</span>
                <span style={{color:col,flexShrink:0}}>{prefix}</span>
                <span className="sset-log-msg">{entry.msg}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  // ── Form action bar — identical on every add/edit form ───────
  // needsDesktop: only the desktop app can connect it (a personal account).
  const FormActions = ({onCancel, onSave, onSaveConnect, canSave, busyLabel, primaryLabel, needsDesktop}) => (
    <div className="sset-pop-actions">
      <button className="sset-btn" onClick={onCancel}>Cancel</button>
      <button className="sset-btn" onClick={onSave} disabled={!canSave}>Save only</button>
      <button className="sset-btn" data-variant="primary" onClick={onSaveConnect}
        disabled={(needsDesktop && !isWV2) || !canSave || !!busyLabel}
        title={needsDesktop && !isWV2 ? 'Needs the desktop app' : undefined}>
        {busyLabel || primaryLabel}
      </button>
    </div>
  );

  const body = (<>
        {/* ── TELEGRAM ─────────────────────────────────────── */}
        {tab === 'telegram' && (<>

          <div className="sset-pop-section">
            {!bare && <div className="sset-pop-section-label">Accounts</div>}

            {tgList.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {tgList.map(a => {
                  const live = tgActiveId === a.id && tgConn.connected;
                  const busyThis = tgActiveId === a.id && tgBusy && !tgConn.connected;
                  const modeLbl = a.mode === 'user' ? 'Personal account' : 'Bot';
                  const desk = a.mode === 'user' && !isWV2;
                  const sub = desk ? 'Needs the desktop app' : a.mode === 'user' ? (a.phone || 'User API') : 'BotFather token';
                  return (
                    <AcctRow key={a.id}
                      live={live} busy={busyThis} anyBusy={tgBusy} needsDesktop={a.mode === 'user'}
                      name={a.label || modeLbl}
                      meta={`${modeLbl} · ${live ? (tgConn.via === 'server' ? 'Running on the server' : 'Connected') : busyThis ? 'Connecting…' : sub}`}
                      onConnect={()=>connectTgAccount(a)}
                      onDisconnect={disconnectTg}
                      onEdit={()=>startEditTg(a)}
                      onRemove={()=>removeTgAccount(a)}/>
                  );
                })}
              </div>
            )}

            {tgEditing !== null ? (
              <div className="sset-pop-form" style={{marginTop:tgList.length?10:0}}>
                <div className="sset-pop-form-title">
                  <span>
                    {tgEditing === 'new' ? 'Add Telegram account' : 'Edit account'}
                  </span>
                  <SsetSeg value={tgMode} onChange={setTgMode}
                    options={[{id:'bot',label:'Bot'},{id:'user',label:'My account'}]}/>
                </div>

                <div className="sset-form-hint" style={{marginTop:-2}}>
                  {tgMode === 'bot'
                    ? 'A bot replies to people who message it.'
                    : !isWV2 ? <span className="sset-desk-note">Needs the desktop app.</span>
                    : 'Uses your own account, so it can start chats too.'}
                </div>

                {tgMode === 'bot' ? (
                  <>
                    <FInput label="Bot token" type="password" value={fld.tgToken}
                      onChange={v=>sv('tgToken',v)} placeholder="1234567890:ABCdef…"
                      info={<>Get one from <strong>@BotFather</strong> in Telegram.</>}/>
                    <FormActions
                      canSave={!!fld.tgToken.trim()}
                      busyLabel={tgBusy ? 'Connecting…' : ''}
                      primaryLabel="Save & connect"
                      onSaveConnect={()=>saveTgAccount(true)}
                      onSave={()=>saveTgAccount(false)}
                      onCancel={()=>setTgEditing(null)}/>
                  </>
                ) : (
                  <>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                      <FInput label="API ID" value={fld.tgApiId} onChange={v=>sv('tgApiId',v)} placeholder="12345678" disabled={!isWV2}/>
                      <FInput label="API hash" type="password" value={fld.tgApiHash} onChange={v=>sv('tgApiHash',v)} placeholder="abc123…" disabled={!isWV2}/>
                    </div>
                    <FInput label="Phone number" value={fld.tgPhone} onChange={v=>sv('tgPhone',v)} placeholder="+1 650 555 0100" disabled={!isWV2}
                      info={<>Telegram sends a login code. If you use 2FA you'll also need your password.</>}/>
                    <FormActions needsDesktop
                      canSave={!!(fld.tgApiId.trim() && fld.tgApiHash.trim() && fld.tgPhone.trim())}
                      busyLabel={tgBusy ? 'Authorising…' : ''}
                      primaryLabel="Save & sign in"
                      onSaveConnect={()=>saveTgAccount(true)}
                      onSave={()=>saveTgAccount(false)}
                      onCancel={()=>setTgEditing(null)}/>
                  </>
                )}

                {(relayErr.telegram || tgConn.error) && <div className="sset-inline-err">{relayErr.telegram || tgConn.error}</div>}
              </div>
            ) : (<>
              {(relayErr.telegram || (!isWV2 && tgConn.error)) && <div className="sset-inline-err" style={{marginTop:8}}>{relayErr.telegram || tgConn.error}</div>}
              <button className="sset-addbtn" onClick={startAddTg} style={{marginTop:tgList.length?8:0}}>
                <span style={{fontSize:14,lineHeight:1}}>+</span>
                Add {tgList.length ? 'another ' : ''}Telegram account
              </button>
              {tgList.length === 0 && isWV2 && (
                <div className="sset-form-hint" style={{marginTop:6}}>Use a bot token, or sign in with your own account.</div>
              )}
            </>)}
            <RunsWhere p="telegram" live={tgConn.connected}/>
          </div>

          <div className="sset-pop-section">
            {!bare && <div className="sset-pop-section-label">Connection</div>}
            <div className="sset-pop-card">
              <div className="sset-form-row">
                <label className="sset-form-label">
                  Reconnect automatically
                  <span className="sset-form-hint">After a restart or a dropped connection.</span>
                </label>
                <div className="sset-form-row-ctl" data-off={!isWV2 ? '1' : undefined} title={!isWV2 ? 'Desktop app only' : undefined}>
                  <SsetTgl checked={(creds.values||{}).tg_auto_reconnect !== '0'}
                    onChange={on=>{ if (isWV2) CRED_STORE.set('tg_auto_reconnect', on?'1':'0'); }}/>
                </div>
              </div>
            </div>
          </div>

          <LogPanel/>
        </>)}

        {/* ── DISCORD ──────────────────────────────────────── */}
        {tab === 'discord' && (<>

          <div className="sset-pop-section">
            {!bare && <div className="sset-pop-section-label">Bots</div>}

            {dcList.length > 0 && (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {dcList.map(a => {
                  const live = dcActiveId === a.id && dcConn.connected;
                  const busyThis = dcActiveId === a.id && dcBusy && !dcConn.connected;
                  return (
                    <AcctRow key={a.id}
                      live={live} busy={busyThis} anyBusy={dcBusy}
                      name={a.label || 'Discord bot'}
                      meta={`Bot · ${live ? (dcConn.via === 'server' ? 'Running on the server' : 'Connected') : busyThis ? 'Connecting…' : 'Bot token'}`}
                      onConnect={()=>connectDcAccount(a)}
                      onDisconnect={disconnectDc}
                      onEdit={()=>startEditDc(a)}
                      onRemove={()=>removeDcAccount(a)}/>
                  );
                })}
              </div>
            )}

            {dcEditing !== null ? (
              <div className="sset-pop-form" style={{marginTop:dcList.length?10:0}}>
                <div className="sset-pop-form-title">
                  <span>{dcEditing === 'new' ? 'Add Discord bot' : 'Edit bot'}</span>
                </div>
                <FInput label="Bot token" type="password" value={fld.dc}
                  onChange={v=>sv('dc',v)} placeholder="MTxxxx.Gxxxxx…"
                  info={<>From <strong>discord.com/developers</strong>. Turn on <strong>Message Content Intent</strong> there.</>}/>
                <div className="sset-form-hint" style={{marginTop:-2}}>Bots can only message people who messaged them first.</div>
                <FormActions
                  canSave={!!fld.dc.trim()}
                  busyLabel={dcBusy ? 'Connecting…' : ''}
                  primaryLabel="Save & connect"
                  onSaveConnect={()=>saveDcAccount(true)}
                  onSave={()=>saveDcAccount(false)}
                  onCancel={()=>setDcEditing(null)}/>
                {(relayErr.discord || dcConn.error) && <div className="sset-inline-err">{relayErr.discord || dcConn.error}</div>}
              </div>
            ) : (<>
              {(relayErr.discord || (!isWV2 && dcConn.error)) && <div className="sset-inline-err" style={{marginTop:8}}>{relayErr.discord || dcConn.error}</div>}
              <button className="sset-addbtn" onClick={startAddDc} style={{marginTop:dcList.length?8:0}}>
                <span style={{fontSize:14,lineHeight:1}}>+</span>
                Add {dcList.length ? 'another ' : ''}Discord bot
              </button>
              {dcList.length === 0 && (
                <div className="sset-form-hint" style={{marginTop:6}}>Paste a bot token from the Discord developer portal.</div>
              )}
            </>)}
            <RunsWhere p="discord" live={dcConn.connected}/>
          </div>

          <LogPanel/>
        </>)}

  </>);
  // Inside the Connections page each platform is its own collapsible card.
  if (bare) return <div className="cx-inner">{body}</div>;
  return (
    <div className="sset-pop-page">

      {/* Tab strip — matches the segmented control used by Preferences. */}
      <div className="sset-pop-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} role="tab" aria-selected={tab===t.id} onClick={()=>setTab(t.id)}>
            {t.icon}
            <span>{t.label}</span>
            {t.live && <Pip col="var(--ok)" sz={5} pulse/>}
          </button>
        ))}
      </div>

      <div className="sset-pop-body">
        {body}
      </div>
    </div>
  );
};

// ── SETTINGS SHEET — LLM Keys ─────────────────────────────────
// Standalone popup for managing LLM provider API keys
// (Gemini, OpenAI, Anthropic).
const SS_LLM = ({bare} = {}) => {
  const creds = useCreds();
  const [fld, setFld] = React.useState({});
  const [savedKey, setSavedKey] = React.useState('');
  const [models, setModels] = React.useState({catalog:{}, selected:{}, defaults:{}});
  const [savingModel, setSavingModel] = React.useState({});
  const timers = React.useRef({});

  // Mirror stored keys into local fields (never clobber what's being typed).
  React.useEffect(()=>{
    setFld(prev => {
      const next = {...prev};
      LLM_PROVIDERS.forEach(p => {
        next[p.id] = prev[p.id] || (creds.values || {})['llm_' + p.id] || '';
      });
      return next;
    });
  }, [creds.loaded]);

  // Server-side model catalog — same source as the legacy settings page.
  React.useEffect(()=>{
    let dead = false;
    apiFetch('get_llm_models', {}).then(r => {
      if (dead || !r || r.error) return;
      setModels({
        catalog:  r.catalog  || {},
        selected: r.selected || {},
        defaults: r.defaults || {},
      });
    }).catch(()=>{});
    return ()=>{ dead = true; };
  }, []);

  const sv = (id, v) => {
    setFld(f => ({...f, [id]: v}));
    if (timers.current[id]) clearTimeout(timers.current[id]);
    timers.current[id] = setTimeout(()=>CRED_STORE.set('llm_' + id, v), 600);
  };
  const saveKey = (id) => {
    CRED_STORE.set('llm_' + id, fld[id] || '');
    setSavedKey(id);
    bcToast('API key saved', 'ok', { detail: ((LLM_PROVIDERS.find(p => p.id === id) || {}).label) || undefined });
    setTimeout(()=>setSavedKey(k => k === id ? '' : k), 1800);
  };
  const saveModel = (id, modelId) => {
    const prev = (models.selected || {})[id] || '';
    setModels(m => ({...m, selected: {...m.selected, [id]: modelId}}));
    setSavingModel(m => ({...m, [id]: true}));
    apiFetch('set_llm_model', {provider:id, model:modelId})
      .then(r => {
        if (!r || r.error) { setModels(m => ({...m, selected:{...m.selected, [id]: prev}})); bcToast('Couldn’t change the model — ' + ((r && r.error) || 'no response'), 'err'); }
        else bcToast('Model updated', 'ok', { detail: modelId });
      })
      .catch(()=> { setModels(m => ({...m, selected:{...m.selected, [id]: prev}})); bcToast('Network error — the model was not changed', 'err'); })
      .finally(()=> setSavingModel(m => { const n = {...m}; delete n[id]; return n; }));
  };

  const active = (creds.values || {}).llm_active || '';
  // The built-in AI: the site's own key, offered by the administrator.
  // Re-read on open, since it can be switched on or off at any time.
  const cat = typeof useLlmCatalog === 'function' ? useLlmCatalog(true) : null;
  const bi = typeof llmBuiltin === 'function' ? llmBuiltin(cat) : null;
  const [biBusy, setBiBusy] = React.useState(false);
  const chooseBuiltin = (on) => {
    // Off: back to a provider the account has a key for (if any).
    const next = on ? 'builtin' : ((LLM_PROVIDERS.find(p => (creds.values || {})['llm_' + p.id]) || {}).id || '');
    if (!next) { bcToast('Add an API key below first, then switch to it', 'err'); return; }
    setBiBusy(true);
    apiFetch('set_active_llm', {provider: next})
      .then(r => {
        if (!r || r.error) { bcToast((r && r.error) || 'Couldn’t change the provider', 'err'); return; }
        CRED_STORE.set('llm_active', next);
        bcToast(on ? 'Using the built-in AI' : 'Using your own key', 'ok');
      })
      .catch(() => bcToast('Network error — the provider was not changed', 'err'))
      .finally(() => setBiBusy(false));
  };

  // Providers collapse to one line each; the key field and model picker
  // open on demand. If nothing has a key yet, the first provider starts
  // open so a new user sees where to paste one.
  const [openId, setOpenId] = React.useState(null);
  React.useEffect(()=>{
    if (!creds.loaded) return;
    const anyKey = LLM_PROVIDERS.some(p => (creds.values || {})['llm_' + p.id]);
    setOpenId(o => o !== null ? o : (anyKey ? '' : LLM_PROVIDERS[0].id));
  }, [creds.loaded]);

  // Hierarchy: the provider in use first, then ones with a key.
  const ordered = [...LLM_PROVIDERS].sort((a, b) => {
    const rank = p => p.id === active ? 0 : ((creds.values || {})['llm_' + p.id] ? 1 : 2);
    return rank(a) - rank(b);
  });

  const body = (<>
        {(bi || active === 'builtin') && (
          <div className="sset-pop-section">
            <div className="sset-pop-section-label">Built-in AI</div>
            <div className="llm-row" data-active={active === 'builtin' && bi ? '1' : '0'}>
              <div className="llm-row-head" style={{cursor:'default'}}>
                <BuiltinAiIcon s={14}/>
                <span className="llm-row-name">Built-in AI</span>
                <span className="llm-row-meta">{bi ? (bi.label || bi.model) : 'Switched off by the administrator'}</span>
                {active === 'builtin' && bi && <span className="bc-state" data-state="ok"><i aria-hidden="true"/>In use</span>}
                {bi && (active === 'builtin'
                  ? <button className="sset-btn" disabled={biBusy} onClick={()=>chooseBuiltin(false)}>Use my own key</button>
                  : <button className="sset-btn" data-variant="primary" disabled={biBusy} onClick={()=>chooseBuiltin(true)}>Use it</button>)}
              </div>
            </div>
            <div className="sset-form-hint" style={{marginTop:6}}>
              {bi ? 'No API key needed: your agents reply with the AI this app provides. You can switch to a key of your own at any time.'
                  : 'The built-in AI isn’t available right now. Your agents use a key of your own below, if you’ve added one.'}
            </div>
          </div>
        )}

        <div className="sset-pop-section">
          <div className="sset-pop-section-label">Provider in use</div>
          <ActiveLlmPicker creds={creds} fld={fld}/>
          <div className="sset-form-hint" style={{marginTop:6}}>All agents reply with this one. Add a key below to make another available{bi ? ', or choose the built-in AI' : ''}.</div>
        </div>

        <div className="sset-pop-section">
          <div className="sset-pop-section-label">Keys</div>
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            {ordered.map(p => {
              const stored   = (creds.values || {})['llm_' + p.id] || '';
              const val      = fld[p.id] || '';
              const has      = !!(val || stored);
              const dirty    = val !== stored;
              const catalog  = (models.catalog  || {})[p.id] || [];
              const def      = (models.defaults || {})[p.id] || '';
              const sel      = (models.selected || {})[p.id] || '';
              const effective = sel || def || (catalog[0] && catalog[0].id) || '';
              const modelLbl = (catalog.find(m => m.id === effective) || {}).label || effective;
              const open = openId === p.id;
              return (
                <div className="llm-row" key={p.id} data-active={active === p.id ? '1' : '0'} data-open={open ? '1' : '0'}>
                  <button type="button" className="llm-row-head" aria-expanded={open}
                    onClick={()=>setOpenId(o => o === p.id ? '' : p.id)}>
                    <p.Icon s={14}/>
                    <span className="llm-row-name">{p.full}</span>
                    <span className="llm-row-meta">{has ? (modelLbl || 'Key saved') : 'Not added'}</span>
                    {active === p.id && <span className="bc-state" data-state="ok"><i aria-hidden="true"/>In use</span>}
                    <svg className="llm-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
                  </button>

                  {open && (
                    <div className="llm-row-body">
                      <div className="sset-pop-item-grid">
                        <FInput label="API key" type="password" value={val}
                          onChange={v=>sv(p.id, v)} placeholder="Paste key…"
                          info={p.hint ? <>Get a key at {p.hint}</> : null}/>
                        <button className="sset-btn" data-variant={dirty && val ? 'primary' : undefined}
                          onClick={()=>saveKey(p.id)} disabled={!val || !dirty}>
                          {savedKey === p.id ? 'Saved' : 'Save'}
                        </button>
                      </div>

                      {catalog.length > 0 && (
                        <div className="sset-pop-row">
                          <span className="sset-pop-row-label">Model</span>
                          <div className="sset-pop-row-ctrl" style={{width:220}}>
                            {savingModel[p.id] && <span style={{fontSize:10,color:'#8a8aa8'}}>saving…</span>}
                            <SsetSelect value={effective} onChange={m=>saveModel(p.id, m)} aria-label="Model"
                              icon={p.Icon ? <p.Icon s={13}/> : 'chip'}
                              options={catalog.map(m => ({value:m.id, label:m.label + (m.id === def ? ' (default)' : '')}))}/>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

  </>);
  if (bare) return <div className="cx-inner">{body}</div>;
  return (
    <div className="sset-pop-page">
      <div className="sset-pop-body">
        {body}
      </div>
    </div>
  );
};

// ── SETTINGS — Preferences pages ──────────────────────────────────────
// Appearance, Notifications and General are pages of the Preferences
// section; the header's tabs switch between them (see SETTINGS_SECTIONS).
// Filters moved to Connections → Filters, and the auto-reply switch moved
// to Connections → LLM.

// ── Connections → Filters (inbound filtering + block list) ────────────
// Per-platform chat-type filters, contacts-only allowlist, and the
// persistent block list. Backed by PREFS_STORE (CRED_STORE-persisted),
// enforced by the inbound gate AND the AI engine.
const SS_Filters = ({part} = {}) => {
  const { prefs } = usePrefs();
  const [tg, dc] = useConn();
  const [newHandle, setNewHandle] = React.useState('');
  const [newPlat, setNewPlat]     = React.useState('telegram');

  const platforms = [
    { id:'telegram', label:'Telegram' },
    { id:'discord',  label:'Discord'  },
  ];
  const chatTypes = [
    { id:'private', label:'Direct messages' },
    { id:'group',   label:'Groups' },
    { id:'channel', label:'Channels' },
  ];

  const allowOf = (p) => (prefs.allow && prefs.allow[p]) || { private:true, group:true, channel:true };
  const addBlock = () => {
    const h = newHandle.trim();
    if (!h) return;
    PREFS_STORE.block(newPlat, { handle: h, name: '' });
    setNewHandle('');
  };

  const blocked = prefs.blocked || [];

  // One grid — a row per kind of chat, a column per platform — instead of
  // the same four switches listed twice.
  const allowPart = (
      <div className="sset-pop-section">
        {!part && <div className="sset-pop-section-label">Who can reach you</div>}
        <div className="sset-pop-card flt-card">
          <div className="flt-grid">
            <span className="flt-h"/>
            <span className="flt-h"><TgIcon s={11}/>Telegram</span>
            <span className="flt-h"><DcIcon s={11}/>Discord</span>
            {chatTypes.map(ct=>(
              <React.Fragment key={ct.id}>
                <span className="flt-label">{ct.label}</span>
                {platforms.map(p=>(
                  <span className="flt-cell" key={p.id}>
                    <SsetTgl checked={allowOf(p.id)[ct.id] !== false}
                      onChange={v=>PREFS_STORE.setAllow(p.id, ct.id, v)}/>
                  </span>
                ))}
              </React.Fragment>
            ))}
            <span className="flt-label">Only people you know<small>Ignore anyone you haven't chatted with before</small></span>
            {platforms.map(p=>(
              <span className="flt-cell" key={p.id}>
                <SsetTgl checked={!!(prefs.contactsOnly && prefs.contactsOnly[p.id])}
                  onChange={v=>PREFS_STORE.setContactsOnly(p.id, v)}/>
              </span>
            ))}
          </div>
        </div>
      </div>
  );
  const blockedPart = (
      <div className="sset-pop-section">
        {!part && <div className="sset-pop-section-label">Block list</div>}
        <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
          <span style={{flexShrink:0}}>
            <SsetSelect value={newPlat} onChange={setNewPlat} aria-label="Platform"
              icon={newPlat === 'discord' ? <DcIcon s={13}/> : <TgIcon s={13}/>}
              options={[{value:'telegram',label:'Telegram'},{value:'discord',label:'Discord'}]}/>
          </span>
          <input className="fi" type="text" value={newHandle}
            placeholder="@username or ID"
            onChange={e=>setNewHandle(e.target.value)}
            onKeyDown={e=>{ if(e.key==='Enter') addBlock(); }}
            style={{flex:1}}/>
          <button className="sset-btn" onClick={addBlock} disabled={!newHandle.trim()}>Block</button>
        </div>
        {blocked.length === 0 ? (
          <div className="sset-pop-empty">
            <div className="sset-pop-empty-sub">No one is blocked. You can also block someone from their chat.</div>
          </div>
        ) : (
          <div className="sset-pop-card">
            {blocked.map((b,i)=>(
              <div className="sset-form-row" key={(b.platform||'')+(b.handle||'')+(b.chatId||'')+i}>
                <div style={{minWidth:0,flex:1}}>
                  <div style={{fontSize:12.5,color:'var(--t1)',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                    {b.name || bcAtHandle(b.handle) || b.chatId || 'Unknown'}
                  </div>
                  <div style={{fontSize:10.5,color:'#8a8aa8',textTransform:'capitalize',marginTop:2}}>
                    {b.platform}{b.handle && b.name ? ' · @'+String(b.handle).replace(/^@/,'') : ''}
                  </div>
                </div>
                <button className="sset-btn" onClick={()=>PREFS_STORE.unblock(b.platform, { handle:b.handle, chatId:b.chatId })}>
                  Unblock
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
  );
  if (part === 'allow') return <div className="cx-inner">{allowPart}</div>;
  if (part === 'blocked') return <div className="cx-inner">{blockedPart}</div>;
  return (
    <div className="sset-pop-body">
      {allowPart}
      {blockedPart}
    </div>
  );
};

// ── Connections (one page) ────────────────────────────────────────────
// Everything that links the app to the outside world on one screen:
// the master auto-reply switch, the messaging apps, the AI provider and
// who may message you. Each part is a row that shows its state in one
// line and opens in place when you need the details.
const CX_GLYPH = {
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></>,
  block:  <><circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/></>,
  spark:  <><path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/></>,
};
const CxGlyph = ({name}) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{CX_GLYPH[name]}</svg>
);
const CxCard = ({icon, title, summary, state, open, onToggle, children}) => (
  <div className="cx-card" data-open={open ? '1' : undefined}>
    <button type="button" className="cx-head" aria-expanded={!!open} onClick={onToggle}>
      <span className="cx-ico" aria-hidden="true">{icon}</span>
      <span className="cx-txt">
        <span className="cx-title">{title}</span>
        <span className="cx-sum">{summary}</span>
      </span>
      {state && <span className="cx-dot" data-s={state} aria-hidden="true"/>}
      <svg className="cx-chev" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
    </button>
    {open && <div className="cx-body">{children}</div>}
  </div>
);
const SS_Connections = () => {
  const [tg, dc] = useConn();
  const creds = useCreds();
  const accts = usePlatformAccounts();
  const { prefs } = usePrefs();
  const vals = creds.values || {};
  const tgList = accts.list('telegram');
  const dcList = accts.list('discord');
  const active = vals.llm_active || '';
  const keyed = LLM_PROVIDERS.filter(p => vals['llm_' + p.id]);
  const activeP = LLM_PROVIDERS.find(p => p.id === active && vals['llm_' + p.id]);

  // Model name for the AI summary (shared catalog, re-read on open so the
  // built-in AI's state is current).
  const cat = typeof useLlmCatalog === 'function' ? useLlmCatalog(true) : null;
  const bi = typeof llmBuiltin === 'function' ? llmBuiltin(cat) : null;
  const onBuiltin = active === 'builtin' && !!bi;

  // Open: whatever another page asked for, otherwise the first thing that
  // still needs setting up. Several parts can be open at once.
  const [open, setOpen] = React.useState(() => {
    const f = window.__cxFocus; window.__cxFocus = null;
    return f ? {[f]: true} : {};
  });
  const seeded = React.useRef(Object.keys(open).length > 0);
  React.useEffect(() => {
    if (seeded.current || !creds.loaded) return;
    seeded.current = true;
    if (!tgList.length && !dcList.length) setOpen({telegram: true});
    else if (!keyed.length && active !== 'builtin') setOpen({ai: true});
    // eslint-disable-next-line
  }, [creds.loaded]);
  const tog = (id) => setOpen(o => ({...o, [id]: !o[id]}));

  const appState = (conn, list) => conn.connected ? 'on' : conn.error ? 'warn' : list.length ? 'idle' : 'off';
  const appSummary = (conn, list, noun) => {
    const who = conn.botName || (conn.username ? '@' + String(conn.username).replace(/^@/, '') : '');
    if (conn.connected) return who ? `Connected as ${who}` : 'Connected';
    if (conn.error) return 'Could not connect. Open to see why.';
    if (list.length) return `${list.length} ${noun}${list.length === 1 ? '' : 's'} saved, not connected`;
    return 'Not set up';
  };

  const modelId = activeP && cat ? ((cat.selected || {})[active] || (cat.defaults || {})[active] || '') : '';
  const modelLbl = modelId && cat && cat.catalog && Array.isArray(cat.catalog[active])
    ? ((cat.catalog[active].find(m => m.id === modelId) || {}).label || modelId) : '';
  const aiSummary = onBuiltin ? `Built-in AI, ${bi.label || bi.model}`
    : active === 'builtin' && !keyed.length ? 'Built-in AI is switched off. Add a key of your own'
    : active === 'builtin' ? `Built-in AI is switched off, using your ${keyed[0].full} key`
    : !keyed.length ? (bi ? 'Not set up. Use the built-in AI or add a key' : 'Not set up')
    : activeP ? `${activeP.full}${modelLbl ? `, ${modelLbl}` : ''}`
    : 'Key saved, choose a provider to use';

  const TYPES = [{id: 'private', l: 'direct messages'}, {id: 'group', l: 'groups'}, {id: 'channel', l: 'channels'}];
  const limits = [['telegram', 'Telegram'], ['discord', 'Discord']].map(([id, name]) => {
    const allow = (prefs.allow && prefs.allow[id]) || {};
    const off = TYPES.filter(t => allow[t.id] === false).map(t => t.l);
    const bits = [];
    if (prefs.contactsOnly && prefs.contactsOnly[id]) bits.push('people you know');
    if (off.length === 3) return `${name}: no one`;
    if (off.length) bits.push(`no ${off.join(' or ')}`);
    return bits.length ? `${name}: ${bits.join(', ')}` : '';
  }).filter(Boolean);
  const blockedN = (prefs.blocked || []).length;

  return (
    <div className="sset-pop-page">
      <div className="sset-pop-body cx">

        <div className="cx-sec">
          <div className="cx-cap">Messaging apps</div>
          <div className="cx-list">
            <CxCard icon={<TgIcon s={14}/>} title="Telegram" open={open.telegram} onToggle={() => tog('telegram')}
              state={appState(tg, tgList)} summary={appSummary(tg, tgList, 'account')}>
              <SS_Platforms platform="telegram" bare/>
            </CxCard>
            <CxCard icon={<DcIcon s={14}/>} title="Discord" open={open.discord} onToggle={() => tog('discord')}
              state={appState(dc, dcList)} summary={appSummary(dc, dcList, 'bot')}>
              <SS_Platforms platform="discord" bare/>
            </CxCard>
          </div>
        </div>

        <div className="cx-sec">
          <div className="cx-cap">AI</div>
          <div className="cx-list">
            <CxCard icon={onBuiltin ? <BuiltinAiIcon s={14}/> : activeP ? <activeP.Icon s={14}/> : <CxGlyph name="spark"/>} title="AI provider"
              open={open.ai} onToggle={() => tog('ai')}
              state={onBuiltin || activeP ? 'on' : keyed.length || active === 'builtin' ? 'warn' : 'off'} summary={aiSummary}>
              <SS_LLM bare/>
            </CxCard>
          </div>
        </div>

        <div className="cx-sec">
          <div className="cx-cap">Privacy</div>
          <div className="cx-list">
            <CxCard icon={<CxGlyph name="shield"/>} title="Who can message you" open={open.allow} onToggle={() => tog('allow')}
              summary={limits.length ? limits.join('; ') : 'Everyone, in every kind of chat'}>
              <SS_Filters part="allow"/>
            </CxCard>
            <CxCard icon={<CxGlyph name="block"/>} title="Blocked people" open={open.blocked} onToggle={() => tog('blocked')}
              summary={blockedN ? `${blockedN} blocked` : 'No one'}>
              <SS_Filters part="blocked"/>
            </CxCard>
          </div>
        </div>
      </div>
    </div>
  );
};

// ── Folding section for Preferences pages ──
// Same section look as the rest of the page; the label becomes a
// disclosure and a short summary shows what's set while it's closed.
const SsetFoldSec = ({title, foldKey, summary, defaultOpen = false, children}) => {
  const [open, toggle] = useFold(foldKey, defaultOpen);
  if (typeof ensureAgxStyles === 'function') ensureAgxStyles();
  return (
    <div className="sset-pop-section" data-fold={open ? 'open' : 'shut'}>
      <button type="button" className="agx-fold sset-fold" aria-expanded={open} onClick={toggle}>
        <FoldChev open={open}/>
        <span className="agx-sec-title">{title}</span>
        {!open && summary && <span className="agx-fold-sum">{summary}</span>}
      </button>
      {open && children}
    </div>
  );
};

// ── Ghost menu button — show/hide toggle ──────────────────────
// The little launcher pill (top-right of the dashboard ghost) used to
// include a button that opened the ghost dev/test panel. It was removed
// from the homepage by request (see GhostDevPanel in bot-ui-views.jsx),
// which left no way to bring the panel back up short of editing code.
// This persists a simple on/off flag in localStorage and fires a custom
// event so EmptyChatAvatar (already mounted, in a different file) can
// pick up the change immediately without needing a shared store/prop
// chain plumbed all the way through.
const GHOST_MENU_BTN_LS_KEY = 'bc.ghost.menuBtn.v1';
const GHOST_MENU_BTN_EVENT  = 'bc:ghost-menu-btn-change';
const getGhostMenuBtnEnabled = () => {
  try { return localStorage.getItem(GHOST_MENU_BTN_LS_KEY) === '1'; } catch (_) { return false; }
};
const setGhostMenuBtnEnabled = (on) => {
  try { localStorage.setItem(GHOST_MENU_BTN_LS_KEY, on ? '1' : '0'); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent(GHOST_MENU_BTN_EVENT, {detail: !!on})); } catch (_) {}
};

// ── SETTINGS SHEET — Appearance sub-panel ─────────────────────
// Everything visual the operator can change: accent, chat width, the
// animated app background, the chat backdrop, panel glass and motion.
// Values are stored by App (useBcTweaks in bot-app.jsx) and applied to the
// document root by bcApplyTheme, so every surface — including popups
// portalled to <body> and the login screen — follows them.

// Muted, desaturated accents that sit well on the dark glass surfaces.
const ACCENT_PRESETS = [
  {hex:'#6c63ff', name:'Indigo'},
  {hex:'#4f7fd9', name:'Blue'},
  {hex:'#3e9c95', name:'Teal'},
  {hex:'#4e9a6c', name:'Green'},
  {hex:'#b98a4a', name:'Amber'},
  {hex:'#b8627a', name:'Rose'},
  {hex:'#8b8fa3', name:'Graphite'},
];
const CHAT_W_MIN = 480;
const CHAT_W_MAX = 1200;

// ── Theme catalogue ───────────────────────────────────────────
// Single source for the options below and for validation/application in
// bot-app.jsx. Background styles are pure CSS (see "THEME" in
// BotCommand.html) and animate transform/opacity only, so they stay
// smooth without repainting the page every frame.
const BC_THEME = {
  styles: [
    {id:'aurora',    label:'Aurora',       animated:true},
    {id:'mist',      label:'Mist',         animated:true},
    {id:'silk',      label:'Silk',         animated:true},
    {id:'waves',     label:'Waves',        animated:true},
    {id:'nebula',    label:'Nebula',       animated:true},
    {id:'orbit',     label:'Orbit',        animated:true},
    {id:'bloom',     label:'Bloom',        animated:true},
    {id:'horizon',   label:'Horizon',      animated:true},
    {id:'stardust',  label:'Stardust',     animated:true},
    {id:'eclipse',   label:'Eclipse',      animated:true},
    {id:'rings',     label:'Rings',        animated:true},
    {id:'kaleido',   label:'Kaleidoscope', animated:true},
    {id:'gradient',  label:'Gradient'},
    {id:'mesh',      label:'Mesh'},
    {id:'spotlight', label:'Spotlight'},
    {id:'solid',     label:'Solid'},
  ],
  palettes: [
    {id:'northern', label:'Northern', c:['#22c55e','#38bdf8','#a855f7','#ec4899'], base:['#030d18','#0a2d26','#0d1f3a']},
    {id:'midnight', label:'Midnight', c:['#6366f1','#3b82f6','#8b5cf6','#0ea5e9'], base:['#04050d','#0a0e22','#110a24']},
    {id:'ocean',    label:'Ocean',    c:['#14b8a6','#06b6d4','#3b82f6','#2dd4bf'], base:['#020b10','#042029','#061831']},
    {id:'ember',    label:'Ember',    c:['#f59e0b','#ef4444','#f97316','#e11d48'], base:['#0c0705','#221007','#1c0910']},
    {id:'orchid',   label:'Orchid',   c:['#d946ef','#8b5cf6','#ec4899','#a855f7'], base:['#0b0611','#1b0a23','#130a21']},
    {id:'forest',   label:'Forest',   c:['#10b981','#84cc16','#14b8a6','#22c55e'], base:['#030c07','#0a2016','#0a1913']},
    {id:'dusk',     label:'Dusk',     c:['#fb7185','#f59e0b','#8b5cf6','#f472b6'], base:['#0a0710','#200f21','#180f25']},
    {id:'graphite', label:'Graphite', c:['#94a3b8','#64748b','#cbd5e1','#475569'], base:['#06070a','#111319','#0b0d12']},
    {id:'accent',   label:'Accent',   c:null, base:null},
  ],
  solids: [
    {hex:'#0b0d17', name:'Ink'},
    {hex:'#101218', name:'Graphite'},
    {hex:'#0a1618', name:'Deep teal'},
    {hex:'#130f1d', name:'Plum'},
    {hex:'#17110d', name:'Espresso'},
    {hex:'#05060a', name:'Black'},
  ],
  surfaces: [
    {id:'none',  label:'None'},
    {id:'tint',  label:'Tinted'},
    {id:'frost', label:'Frosted'},
  ],
  speeds: [
    {id:'still',  label:'Still'},
    {id:'slow',   label:'Slow'},
    {id:'medium', label:'Medium'},
    {id:'fast',   label:'Fast'},
  ],
  glass: [
    {id:'clear',    label:'Clear'},
    {id:'balanced', label:'Balanced'},
    {id:'solid',    label:'Solid'},
  ],
  // Shipped look: Graphite accent, Mist over the Ocean palette, medium
  // motion, 48% background intensity, vignette and grain, and a 58% tinted
  // chat surface. Anything the operator changes in Preferences →
  // Appearance still overrides these.
  defaults: {
    bgStyle:'mist', bgPalette:'ocean', bgSpeed:'medium', bgIntensity:48,
    bgSolid:'#0b0d17', bgVignette:true, bgGrain:true,
    chatSurface:'tint', chatSurfaceStrength:58,
    glass:'balanced', reduceMotion:false,
  },
};

// Colour helpers — used to derive the "Accent" palette from --acc.
const bcHexToHsl = (hex) => {
  const n = parseInt(String(hex||'#6c63ff').slice(1), 16);
  let r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
  let h = 0, s = 0; const l = (mx + mn) / 2;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
};
const bcHslToHex = (h, s, l) => {
  h = ((h % 360) + 360) % 360; s = Math.max(0, Math.min(100, s)) / 100; l = Math.max(0, Math.min(100, l)) / 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return '#' + [f(0), f(8), f(4)].map(x => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
};
const bcAccentPalette = (hex) => {
  const [h, s] = bcHexToHsl(hex);
  const sat = Math.max(35, Math.min(80, s));
  return {
    c: [bcHslToHex(h, sat, 60), bcHslToHex(h + 32, sat, 58), bcHslToHex(h - 36, sat, 62), bcHslToHex(h + 14, sat * 0.8, 70)],
    base: [bcHslToHex(h, 30, 4), bcHslToHex(h + 20, 38, 10), bcHslToHex(h - 20, 34, 9)],
  };
};
const bcPalette = (id, accent) => {
  if (id === 'accent') return bcAccentPalette(accent);
  return BC_THEME.palettes.find(p => p.id === id) || BC_THEME.palettes[0];
};

// ── Small building blocks ─────────────────────────────────────
const BcTile = ({active, label, onClick, children}) => (
  <button type="button" className="bc-tile" data-on={active ? '1' : '0'} aria-pressed={active}
    onClick={onClick} title={label}>
    <span className="bc-tile-prev">{children}</span>
    <span className="bc-tile-label">{label}</span>
  </button>
);
const ApRow = ({label, hint, children, wide}) => (
  <div className="sset-form-row">
    <label className="sset-form-label">
      {label}
      {hint && <span className="sset-form-hint">{hint}</span>}
    </label>
    <div className="sset-form-row-ctl" style={wide ? {width:210, maxWidth:210} : undefined}>{children}</div>
  </div>
);
const ApSeg = ({value, options, onChange, label}) => (
  <div className="bc-seg" role="radiogroup" aria-label={label} style={{minWidth:0}}>
    {options.map(o => (
      <button key={o.id} type="button" role="radio" aria-checked={value === o.id}
        data-on={value === o.id ? '1' : '0'} onClick={() => onChange(o.id)}>{o.label}</button>
    ))}
  </div>
);
const ApRange = ({value, min, max, step = 1, onChange, suffix = '', label}) => (
  <>
    <input type="range" className="sset-range" min={min} max={max} step={step}
      value={value} aria-label={label}
      onChange={e => onChange(Number(e.target.value))} style={{flex:1, minWidth:0}}/>
    <span className="sset-range-value">{value}{suffix}</span>
  </>
);
const ApSwitch = ({checked, onChange, label}) => (
  <button type="button" className="bc-switch" role="switch" aria-checked={!!checked}
    aria-label={label} data-on={checked ? '1' : '0'} onClick={() => onChange(!checked)}/>
);

// ── Preferences: shared parts ─────────────────────────────────────
// Each page is a short stack of cards. A card's header row opens it in
// place; only one card is open at a time, so a page never needs a long
// scroll. Rows are the wizard's (.wz-row) so switches, segmented choices
// and sliders look the same everywhere in the popup.
const usePrefOpen = (key, def) => {
  const [open, setOpen] = React.useState(() => {
    try { const v = window.localStorage.getItem('bc.pref.open.' + key); return v == null ? def : v; } catch (_) { return def; }
  });
  const toggle = (id) => setOpen(o => {
    const n = o === id ? '' : id;
    try { window.localStorage.setItem('bc.pref.open.' + key, n); } catch (_) {}
    return n;
  });
  return [open, toggle];
};
const PfSec = ({id, icon, title, summary, open, onToggle, children}) => (
  <div className="wz-group pf-card" data-open={open ? '1' : undefined}>
    <button type="button" className="wz-row pf-head" data-ico="1" aria-expanded={open} onClick={() => onToggle(id)}>
      <span className="wz-ico"><WzSvg name={icon}/></span>
      <span className="wz-row-title wz-grow">{title}</span>
      {summary != null && <span className="pe-sum" data-set="1">{summary}</span>}
      <FoldChev open={open}/>
    </button>
    {open && <div className="pf-body">{children}</div>}
  </div>
);
// Title on the left, a control on the right.
const PfRow = ({icon, title, hint, children}) => (
  <div className="wz-row pf-row" data-ico={icon ? '1' : undefined}>
    {icon && <span className="wz-ico"><WzSvg name={icon}/></span>}
    <span className="wz-row-txt">
      <span className="wz-row-title">{title}</span>
      {hint && <span className="wz-row-hint">{hint}</span>}
    </span>
    <span className="pf-ctl">{children}</span>
  </div>
);
const PfRange = ({value, min, max, step = 1, onChange, suffix = '', label}) => (
  <span className="pf-range">
    <input type="range" className="sset-range" min={min} max={max} step={step} value={value} aria-label={label}
      onChange={e => onChange(Number(e.target.value))}/>
    <span className="pf-range-val">{value}{suffix}</span>
  </span>
);

// ── Preferences → Appearance ──────────────────────────────────────
// Every option here is applied by bcApplyTheme (bot-app.jsx). Removed:
// "Compact tables", which nothing read.
const SS_Appearance = ({tweaks, setTweak}) => {
  const [ghostMenuBtn, setGhostMenuBtnState] = React.useState(getGhostMenuBtnEnabled);
  const [open, toggle] = usePrefOpen('appearance', 'background');
  // Visual effects (BC_PERF in BotCommand.html): Auto picks Light on its own
  // when this computer draws the effects slowly.
  const perf = (typeof window !== 'undefined' && window.BC_PERF) || null;
  const [perfForce, setPerfForce] = React.useState(() => (perf && perf.force) || 'auto');
  const [perfMode, setPerfMode] = React.useState(() => (perf && perf.mode) || 'full');
  React.useEffect(() => {
    const h = (e) => setPerfMode((e && e.detail && e.detail.mode) || 'full');
    window.addEventListener('bc:perf', h);
    return () => window.removeEventListener('bc:perf', h);
  }, []);
  const T = {...BC_THEME.defaults, ...tweaks};
  const set = (k) => (v) => setTweak(k, v);
  const style = BC_THEME.styles.find(s => s.id === T.bgStyle) || BC_THEME.styles[0];
  const animated = !!style.animated;
  const pal = BC_THEME.palettes.find(p => p.id === T.bgPalette) || BC_THEME.palettes[0];
  const accent = String(tweaks.accentColor || '#6c63ff').toLowerCase();
  const accentName = (ACCENT_PRESETS.find(p => p.hex === accent) || {}).name || 'Custom';
  const surfLabel = (BC_THEME.surfaces.find(o => o.id === T.chatSurface) || {}).label || 'None';
  const glassLabel = (BC_THEME.glass.find(o => o.id === T.glass) || {}).label || 'Balanced';
  const chatW = Math.min(CHAT_W_MAX, Math.max(CHAT_W_MIN, Number(tweaks.chatWidth) || 680));
  const resetTheme = () => setTweak({...BC_THEME.defaults, accentColor: '#8b8fa3', chatWidth: 680});

  return (
    <div className="sset-pop-body pf-page">
      <div className="wz pf">
        {/* Accent: always in view, it is the one most people change. */}
        <div className="wz-group">
          <div className="wz-row pf-row" data-ico="1">
            <span className="wz-ico"><span className="pf-dot" style={{background: accent}}/></span>
            <span className="wz-row-txt">
              <span className="wz-row-title">Accent</span>
              <span className="wz-row-hint">{accentName}</span>
            </span>
            <span className="pf-ctl">
              <span className="bc-swatches" role="radiogroup" aria-label="Accent colour">
                {ACCENT_PRESETS.map(p => (
                  <button key={p.hex} type="button" role="radio" aria-checked={accent === p.hex}
                    className="bc-swatch" data-on={accent === p.hex ? '1' : '0'}
                    style={{'--sw': p.hex}} title={p.name} aria-label={p.name}
                    onClick={() => setTweak('accentColor', p.hex)}/>
                ))}
                {(() => {
                  const custom = !ACCENT_PRESETS.some(p => p.hex === accent);
                  return (
                    <label className="bc-swatch bc-swatch-custom" data-on={custom ? '1' : '0'}
                      style={custom ? {'--sw': accent} : undefined} title="Custom colour">
                      <input type="color" value={accent} onChange={e => setTweak('accentColor', e.target.value)} aria-label="Custom accent colour"/>
                    </label>
                  );
                })()}
              </span>
            </span>
          </div>
        </div>

        <PfSec id="background" icon="image" title="Background" open={open === 'background'} onToggle={toggle}
          summary={style.id === 'solid' ? 'Solid colour' : `${style.label} · ${pal.label}`}>
          <div className="pf-block">
            <div className="bc-tiles pf-tiles" role="radiogroup" aria-label="Background style">
              {BC_THEME.styles.map(s => (
                <BcTile key={s.id} label={s.label} active={T.bgStyle === s.id} onClick={() => setTweak('bgStyle', s.id)}>
                  <span className="fxl bc-tile-fx" data-bg={s.id}/>
                </BcTile>
              ))}
            </div>
            {style.id === 'solid' ? (
              <div className="bc-swatches pf-solids" role="radiogroup" aria-label="Background colour">
                {BC_THEME.solids.map(p => {
                  const sel = (T.bgSolid || '').toLowerCase() === p.hex;
                  return <button key={p.hex} type="button" role="radio" aria-checked={sel} className="bc-swatch bc-swatch-lg"
                    data-on={sel ? '1' : '0'} style={{'--sw': p.hex}} title={p.name} aria-label={p.name} onClick={() => setTweak('bgSolid', p.hex)}/>;
                })}
                {(() => {
                  const custom = !BC_THEME.solids.some(p => p.hex === (T.bgSolid || '').toLowerCase());
                  return (
                    <label className="bc-swatch bc-swatch-lg bc-swatch-custom" data-on={custom ? '1' : '0'}
                      style={custom ? {'--sw': T.bgSolid} : undefined} title="Custom colour">
                      <input type="color" value={T.bgSolid} onChange={e => setTweak('bgSolid', e.target.value)} aria-label="Custom background colour"/>
                    </label>
                  );
                })()}
              </div>
            ) : (
              <div className="pf-pals" role="radiogroup" aria-label="Palette">
                {BC_THEME.palettes.map(p => {
                  const pp = bcPalette(p.id, tweaks.accentColor);
                  const sel = T.bgPalette === p.id;
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={sel} className="pf-pal" data-on={sel ? '1' : undefined}
                      onClick={() => setTweak('bgPalette', p.id)} title={p.label}>
                      <span className="pf-pal-bar" style={{background: `linear-gradient(90deg, ${pp.c.join(', ')})`}}/>
                      <span className="pf-pal-name">{p.label}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {animated && (
            <PfRow icon="wave" title="Motion">
              <WzSeg label="Motion speed" value={T.bgSpeed} onChange={set('bgSpeed')}
                options={BC_THEME.speeds.map(s => ({value: s.id, label: s.label}))}/>
            </PfRow>
          )}
          {style.id !== 'solid' && (
            <PfRow icon="sliders" title="Intensity">
              <PfRange label="Intensity" min={20} max={100} step={5} value={T.bgIntensity} onChange={set('bgIntensity')} suffix="%"/>
            </PfRow>
          )}
          <WzSwitchRow icon="eye" title="Vignette" hint="Darker edges" on={!!T.bgVignette} onChange={set('bgVignette')}/>
          <WzSwitchRow icon="spark" title="Film grain" hint="Fine texture" on={!!T.bgGrain} onChange={set('bgGrain')}/>
        </PfSec>

        <PfSec id="chat" icon="bubble" title="Chat" open={open === 'chat'} onToggle={toggle}
          summary={`${chatW}px · ${surfLabel}`}>
          <PfRow icon="text" title="Width" hint="Widest the messages get">
            <PfRange label="Chat width" min={CHAT_W_MIN} max={CHAT_W_MAX} step={20} value={chatW} onChange={set('chatWidth')} suffix="px"/>
          </PfRow>
          <PfRow icon="stack" title="Backdrop" hint="Behind the messages">
            <WzSeg label="Chat backdrop" value={T.chatSurface} onChange={set('chatSurface')}
              options={BC_THEME.surfaces.map(s => ({value: s.id, label: s.label}))}/>
          </PfRow>
          {T.chatSurface !== 'none' && (
            <PfRow icon="sliders" title={T.chatSurface === 'frost' ? 'Frost' : 'Tint'}>
              <PfRange label="Backdrop strength" min={0} max={100} step={5} value={T.chatSurfaceStrength} onChange={set('chatSurfaceStrength')} suffix="%"/>
            </PfRow>
          )}
        </PfSec>

        <PfSec id="windows" icon="badge" title="Windows and motion" open={open === 'windows'} onToggle={toggle}
          summary={`${glassLabel} glass${T.reduceMotion ? ' · reduced motion' : ''}`}>
          <PfRow icon="badge" title="Glass" hint="Popups, menus, sign-in">
            <WzSeg label="Panel glass" value={T.glass} onChange={set('glass')}
              options={BC_THEME.glass.map(s => ({value: s.id, label: s.label}))}/>
          </PfRow>
          <WzSwitchRow icon="moon" title="Reduce motion" hint="Stops every background animation"
            on={!!T.reduceMotion} onChange={set('reduceMotion')}/>
          {perf && (
            <PfRow icon="spark" title="Visual effects"
              hint={perfForce === 'auto'
                ? (perfMode === 'lite' ? 'Auto — using Light, this computer was slow with Full' : 'Auto — switches to Light if this computer is slow')
                : perfForce === 'lite' ? 'No blur or moving background — smoothest' : 'Every effect, always'}>
              <WzSeg label="Visual effects" value={perfForce}
                onChange={(v) => { setPerfForce(v); try { perf.setForce(v); } catch (_) {} }}
                options={[{value: 'auto', label: 'Auto'}, {value: 'full', label: 'Full'}, {value: 'lite', label: 'Light'}]}/>
            </PfRow>
          )}
        </PfSec>

        <PfSec id="dev" icon="wrench" title="Developer" open={open === 'dev'} onToggle={toggle}
          summary={ghostMenuBtn ? 'Test menu shown' : 'Off'}>
          <WzSwitchRow icon="robot" title="Ghost test menu" hint="Button next to the ghost on the home screen"
            on={ghostMenuBtn} onChange={v => { setGhostMenuBtnState(v); setGhostMenuBtnEnabled(v); }}/>
        </PfSec>

        <div className="pf-foot">
          <button type="button" className="wz-chip" onClick={resetTheme} title="Back to the shipped look">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>
            Reset appearance
          </button>
        </div>
      </div>
    </div>
  );
};

// ── Preferences → Notifications ───────────────────────────────────
// Wired to BC_NOTIFY (bot-stores.jsx): every switch here changes what
// actually happens when the event fires.
const SS_Notifications = () => {
  const [p, setP] = useNotifyPrefs();
  const [perm, setPerm] = React.useState(() => BC_NOTIFY.desktopSupport());
  const unsupported = perm === 'none';
  const denied = perm === 'denied';
  const flipDesktop = async (v) => {
    if (!v) { setP({desktop: false}); return; }
    let r = BC_NOTIFY.desktopSupport();
    if (r === 'default') r = await BC_NOTIFY.askDesktop();
    setPerm(r);
    setP({desktop: r === 'granted'});
  };
  const EVENTS = [
    {k: 'handover',   icon: 'hand',   title: 'Needs you',         hint: 'An agent handed a chat to you'},
    {k: 'newChat',    icon: 'bubble', title: 'New conversation',  hint: 'Someone messages for the first time'},
    {k: 'payment',    icon: 'wallet', title: 'Payment received',  hint: 'An invoice was paid'},
    {k: 'aiError',    icon: 'bolt',   title: 'Agent couldn’t reply', hint: 'An AI reply failed'},
    {k: 'newMessage', icon: 'text',   title: 'Every new message', hint: 'Any message in a chat you don’t have open'},
  ];
  const on = EVENTS.filter(e => p[e.k]).length;
  return (
    <div className="sset-pop-body pf-page">
      <div className="wz pf">
        <div className="pe-cap"><span>Tell me when</span><small>{on} of {EVENTS.length} on</small></div>
        <div className="wz-group">
          {EVENTS.map(e => (
            <WzSwitchRow key={e.k} icon={e.icon} title={e.title} hint={e.hint} on={!!p[e.k]} onChange={v => setP({[e.k]: v})}/>
          ))}
        </div>

        <div className="pe-cap"><span>How</span></div>
        <div className="wz-group">
          <div className="wz-row pf-row" data-ico="1" role="switch" aria-checked={!!p.sound} tabIndex={0}
            onClick={() => setP({sound: !p.sound})}
            onKeyDown={ev => { if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); setP({sound: !p.sound}); } }}>
            <span className="wz-ico"><WzSvg name="megaphone"/></span>
            <span className="wz-row-txt"><span className="wz-row-title">Sound</span><span className="wz-row-hint">A short chime for each alert</span></span>
            <button type="button" className="wz-chip" onClick={ev => { ev.stopPropagation(); BC_NOTIFY.chime('handover'); }} title="Play the chime">
              <WzSvg name="play" size={11}/>Test
            </button>
            <span className="bc-switch" data-on={p.sound ? '1' : '0'} aria-hidden="true"/>
          </div>
          <WzSwitchRow icon="badge" title="Desktop alerts"
            hint={unsupported ? 'Not available in this window' : denied ? 'Blocked. Allow notifications for this site first.' : 'A pop-up outside the app'}
            disabled={unsupported || denied} on={!!p.desktop && perm === 'granted'} onChange={flipDesktop}/>
          <WzSwitchRow icon="moon" title="Only when I’m away" hint="Quiet while the app is in front. “Needs you” always alerts."
            on={!!p.onlyAway} onChange={v => setP({onlyAway: v})}/>
        </div>
      </div>
    </div>
  );
};

// ── LOGIN / REGISTER ─────────────────────────────────────────
// Shown whenever AUTH_STORE.account is null AND AUTH_STORE.checked is true.
// Single-page swap between sign-in and sign-up; both submit to the auth_*
// API endpoints which set a session cookie on success and trigger a re-render
// of <App/> via AUTH_STORE.set().
//
// Look: the app's OWN themed background (the animated .bg-base layer the
// user picked in Preferences → Appearance) shows straight through. Above a
// dark panel with full-width LOGIN / REGISTER tabs sits the company name in
// Orbitron, filled with a teal-to-blue gradient that slides back and forth;
// a glint rides the panel's top edge in step with it, like the logo's light
// reflecting onto the panel. Fields have small blue caps labels over dark
// rounded boxes, and the submit is a full-width indigo button with an icon.
// State is shown quietly — no colour washes:
//   busy     → the button label cross-fades to a spinner
//   error    → a slight nudge, a hairline on the field, a neutral message
//   success  → the label cross-fades to a check, then the panel fades out
//              WHILE the boot loader fades in over it (one continuous
//              cross-fade, no gap, no pop), and the workspace loads under it
// Styles are injected from here (ensureAuthStyles) so this screen is
// self-contained, and respect both prefers-reduced-motion and the app's own
// "Reduce motion" setting (html[data-motion="reduced"]).
const BCA_CSS = `
.bca {
  --bca-acc: var(--acc, #6c63ff);
  --bca-ok: #30d158;
  --bca-err: #ff453a;
  /* The look: a dark tabbed panel under an animated wordmark. */
  --bca-teal: #3dd4b0;
  --bca-blue: #6b8fdb;
  /* The wordmark's colours come from the theme's palette (Preferences →
     Appearance: --fx1..3, Ocean by default), each mixed well into a cool
     grey so they sit quietly on the dark instead of glowing. The plain
     values are the fallback where color-mix isn't supported. */
  --bca-l1: #52b9aa; --bca-l2: #4fb0c2; --bca-l3: #7394cf;
  --bca-l1: color-mix(in oklab, var(--fx1, #14b8a6) 58%, #a9afbd);
  --bca-l2: color-mix(in oklab, var(--fx2, #06b6d4) 54%, #a9afbd);
  --bca-l3: color-mix(in oklab, var(--fx3, #3b82f6) 56%, #a9afbd);
  --bca-card: #16181c;
  --bca-card2: #131417;
  --bca-tab: #22252a;
  --bca-field: #1d1f23;
  --bca-edge: rgba(255,255,255,.09);
  --bca-label: #4f78bd;
  --bca-text: #e8e9ec;
  --bca-dim: #71747c;
  --bca-btn: #343f8e;
  --bca-btn2: #2c3579;
  --bca-btn-edge: #4d5cc4;
  --bca-dur: 4.8s;
  position: fixed; inset: 0; z-index: 1000;
  /* Pinned from the top rather than centred: when the status line or the
     register fields open, the panel grows DOWNWARD and nothing above it
     (the wordmark, the tabs) moves. */
  display: flex; align-items: flex-start; justify-content: center;
  padding: max(24px, calc(50vh - 200px)) 24px 24px; overflow-y: auto; overflow-x: hidden;
  background: transparent;           /* the themed .bg-base shows through */
  color: var(--bca-text);
  font-family: 'DM Sans', var(--font, 'Inter', sans-serif);
  isolation: isolate;
}
.bca-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden;
  clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

/* ── Stage: wordmark over the panel ─────────────────────────── */
.bca-stage { width: 100%; max-width: 356px; margin: 0 auto;
  display: flex; flex-direction: column; align-items: stretch; gap: 7px; }

/* The wordmark: Orbitron, wide and bold, filled with a gradient of the
   theme's colours that slides back and forth. The same sweep lights the panel's
   top edge (.bca-glint), so the logo reads as reflecting onto it.
   Orbitron draws its first letter .05em in from the edge of its box; the
   negative margin takes that back, so the ink of the first letter lines up
   exactly with the panel's outer left edge at any size. */
.bca-word {
  align-self: flex-start; margin: 0 0 0 -.05em;
  font: 700 20px/1 'Orbitron', var(--font, 'Inter', sans-serif);
  letter-spacing: .07em; text-transform: uppercase; white-space: nowrap;
  background: linear-gradient(90deg, var(--bca-l1) 0%, var(--bca-l2) 28%, var(--bca-l3) 56%,
    color-mix(in oklab, var(--bca-l3) 80%, #dfe3ea) 72%, var(--bca-l1) 100%);
  background-size: 260% 100%;
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  filter: drop-shadow(0 0 12px rgba(120,150,170,.10));
  filter: drop-shadow(0 0 12px color-mix(in srgb, var(--bca-l1) 14%, transparent));
  -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
  user-select: none; -webkit-user-select: none; pointer-events: none;
  animation: bca-word-in .9s cubic-bezier(.16,1,.3,1) both, bca-flow var(--bca-dur) ease-in-out infinite alternate;
  transition: opacity .38s cubic-bezier(.4,0,.2,1), transform .45s cubic-bezier(.4,0,.2,1);
}
@keyframes bca-word-in { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }
@keyframes bca-flow { from { background-position: 0% 50%; } to { background-position: 100% 50%; } }
.bca[data-leaving="1"] .bca-word { opacity: 0; transform: translateY(-3px); }

/* ── Panel ──────────────────────────────────────────────────── */
.bca-card {
  position: relative; width: 100%; overflow: hidden;
  border-radius: 12px;
  background: linear-gradient(180deg, #181a1e 0%, var(--bca-card) 40%, var(--bca-card2) 100%);
  border: 1px solid var(--bca-edge);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04), 0 28px 70px -30px rgba(0,0,0,.85), 0 2px 10px rgba(0,0,0,.35);
  animation: bca-in .8s cubic-bezier(.16,1,.3,1) .08s both;
  transition: transform .45s cubic-bezier(.4,0,.2,1), opacity .38s cubic-bezier(.4,0,.2,1);
  will-change: opacity, transform;
}
.bca-card[data-entered="1"] { animation: none; }
.bca[data-state="error"] .bca-card { animation: bca-nudge .32s cubic-bezier(.36,.07,.19,.97) both; }
.bca[data-leaving="1"] .bca-card { animation: none; transform: scale(.985); opacity: 0; }
@keyframes bca-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes bca-nudge { 25% { transform: translateX(-2px); } 75% { transform: translateX(2px); } }

/* The reflection: a glint riding the panel's top edge with a soft sheen
   spilling down over the tabs, sliding in step with the wordmark. It is
   brightest right under the wordmark and fades the further it travels
   from it (the mask), the way a reflection falls off away from its light. */
.bca-glint { position: absolute; top: 0; left: 0; right: 0; height: 52px; z-index: 3; pointer-events: none; overflow: hidden;
  -webkit-mask-image: linear-gradient(90deg, #000 0%, #000 34%, rgba(0,0,0,.45) 58%, rgba(0,0,0,.12) 80%, transparent 100%);
          mask-image: linear-gradient(90deg, #000 0%, #000 34%, rgba(0,0,0,.45) 58%, rgba(0,0,0,.12) 80%, transparent 100%); }
.bca-glint i {
  position: absolute; top: 0; left: 0; width: 42%; height: 52px;
  animation: bca-glint var(--bca-dur) ease-in-out infinite alternate;
  will-change: transform;
}
.bca-glint i::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 1px;
  background: linear-gradient(90deg, transparent 0%, rgba(82,185,170,.5) 30%, rgba(200,215,230,.6) 50%, rgba(115,148,207,.5) 70%, transparent 100%);
  background: linear-gradient(90deg, transparent 0%,
    color-mix(in srgb, var(--bca-l1) 55%, transparent) 30%,
    color-mix(in srgb, color-mix(in oklab, var(--bca-l2) 55%, #eef1f5) 62%, transparent) 50%,
    color-mix(in srgb, var(--bca-l3) 55%, transparent) 70%, transparent 100%);
}
.bca-glint i::after {
  content: ''; position: absolute; top: 0; left: 8%; right: 8%; height: 40px;
  background: radial-gradient(ellipse 50% 100% at 50% 0%, rgba(90,170,180,.09) 0%, rgba(110,140,200,.04) 45%, transparent 75%);
  background: radial-gradient(ellipse 50% 100% at 50% 0%,
    color-mix(in srgb, var(--bca-l2) 10%, transparent) 0%,
    color-mix(in srgb, var(--bca-l3) 4%, transparent) 45%, transparent 75%);
}
@keyframes bca-glint { from { transform: translateX(-18%); } to { transform: translateX(156%); } }

/* ── LOGIN / REGISTER tabs — full width across the panel's top ─ */
.bca-seg { position: relative; display: grid; grid-template-columns: 1fr 1fr;
  background: var(--bca-card2); border-bottom: 1px solid var(--bca-edge); }
.bca-seg::after { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--bca-edge); pointer-events: none; }
/* Three tabs (Login · Register · Guest) when someone arrives from a contact link. */
.bca-seg[data-cols="3"] { grid-template-columns: 1fr 1fr 1fr; }
.bca-seg[data-cols="3"]::before { content: ''; position: absolute; top: 0; bottom: 0; left: 33.333%; width: 1px; background: var(--bca-edge); pointer-events: none; }
.bca-seg[data-cols="3"]::after { left: 66.666%; }
.bca-seg[data-cols="3"] .bca-seg-ind { width: 33.334%; }
.bca-seg[data-cols="3"][data-mode="register"] .bca-seg-ind { transform: translateX(100%); }
.bca-seg[data-cols="3"][data-mode="guest"] .bca-seg-ind { transform: translateX(200%); }
.bca-seg-ind { position: absolute; top: 0; bottom: 0; left: 0; width: 50%;
  background: linear-gradient(180deg, #282b31 0%, var(--bca-tab) 100%);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.04);
  transition: transform .32s cubic-bezier(.22,1,.36,1); }
.bca-seg[data-mode="register"] .bca-seg-ind { transform: translateX(100%); }
.bca-seg button { position: relative; z-index: 1; height: 36px; background: none; border: 0; cursor: pointer;
  font: 700 10.5px 'DM Sans', var(--font, 'Inter', sans-serif); letter-spacing: .13em; text-transform: uppercase;
  color: var(--bca-dim); transition: color .16s ease; }
.bca-seg button:hover { color: #a4a7ae; }
.bca-seg button[aria-selected="true"] { color: #f3f4f6; }
.bca-seg button:focus-visible { outline: 2px solid rgba(107,143,219,.55); outline-offset: -2px; }
.bca-seg button:disabled { cursor: default; }

.bca-body { padding: 17px 17px 13px; }
.bca-note { margin: -3px 0 12px; font-size: 11.5px; line-height: 1.5; color: #9fb4dc; }
/* Guest tab: who you're about to message, and what a guest chat is. */
.bca-to { display: flex; align-items: center; gap: 10px; margin: -2px 0 14px; padding: 9px 11px; border-radius: 10px;
  background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.06); }
.bca-to-ava { width: 28px; height: 28px; flex: 0 0 auto; border-radius: 50%; display: grid; place-items: center;
  font: 700 11px 'DM Sans', var(--font, 'Inter', sans-serif); color: #fff; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
.bca-to-t { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.bca-to-l { font: 700 9px/1.2 'DM Sans', var(--font, 'Inter', sans-serif); letter-spacing: .13em; text-transform: uppercase; color: var(--bca-dim); }
.bca-to-n { font-size: 13px; font-weight: 500; color: var(--bca-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bca-fine { display: flex; align-items: flex-start; gap: 7px; margin: 0; padding: 0 2px; font-size: 11px; line-height: 1.5; color: var(--bca-dim); }
.bca-fine svg { flex: 0 0 auto; margin-top: 2px; opacity: .8; }

/* ── Fields — small blue caps label above a dark rounded box ── */
.bca-form { display: flex; flex-direction: column; gap: 12px; }
.bca-swap { display: flex; flex-direction: column; gap: 12px; animation: bca-swap .35s cubic-bezier(.22,1,.36,1) both; }
@keyframes bca-swap { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
.bca-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.bca-f { position: relative; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
.bca-lb { font: 700 9px/1 'DM Sans', var(--font, 'Inter', sans-serif); letter-spacing: .13em; text-transform: uppercase;
  color: var(--bca-label); padding-left: 1px; user-select: none; }
.bca-box { position: relative; }
.bca-in {
  width: 100%; height: 36px; padding: 0 12px; border-radius: 9px;
  background: var(--bca-field); border: 1px solid rgba(255,255,255,.08);
  color: var(--bca-text); font: 400 13px 'DM Sans', var(--font, 'Inter', sans-serif);
  outline: none; transition: border-color .15s, background .15s, box-shadow .2s;
}
.bca-in::placeholder { color: #666970; opacity: 1; }
.bca-f[data-pad="1"] .bca-in { padding-right: 38px; }
.bca-in:hover { border-color: rgba(255,255,255,.13); }
.bca-in:focus { background: #202227; border-color: rgba(98,120,214,.7);
  box-shadow: 0 0 0 3px rgba(77,92,196,.18); }
.bca-in:disabled { opacity: .6; }
.bca-in:-webkit-autofill { -webkit-text-fill-color: var(--bca-text); transition: background-color 9999s; box-shadow: 0 0 0 40px var(--bca-field) inset; }
.bca-f[data-invalid="1"] .bca-in { border-color: rgba(255,120,110,.4); }
.bca-f[data-invalid="1"] .bca-lb { color: #d98a84; }
.bca-f[data-ok="1"] .bca-in { border-color: rgba(61,212,176,.28); }
.bca-reveal { position: absolute; right: 4px; top: 50%; translate: 0 -50%; width: 28px; height: 28px;
  display: grid; place-items: center; border-radius: 7px; color: #6b6e76; background: none; border: 0; cursor: pointer;
  transition: background .15s, color .15s; }
.bca-reveal:hover { background: rgba(255,255,255,.06); color: var(--bca-text); }
.bca-reveal:focus-visible { outline: 2px solid rgba(107,143,219,.55); }

/* Password strength (register) and caps lock hint */
.bca-meta { display: flex; align-items: center; gap: 10px; min-height: 14px; margin-top: -4px; padding: 0 2px;
  font-size: 10.5px; color: var(--bca-dim); }
.bca-meter { flex: 1; display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
.bca-meter i { height: 2px; border-radius: 2px; background: rgba(255,255,255,.07); transition: background .3s ease; }
.bca-meter[data-s="1"] i:nth-child(-n+1) { background: var(--bca-err); }
.bca-meter[data-s="2"] i:nth-child(-n+2) { background: var(--warn, #ff9f0a); }
.bca-meter[data-s="3"] i:nth-child(-n+3) { background: var(--bca-blue); }
.bca-meter[data-s="4"] i { background: var(--bca-teal); }
.bca-caps { color: var(--warn, #ff9f0a); display: inline-flex; align-items: center; gap: 5px; animation: bca-swap .25s ease both; }

/* Status line (error / success) */
.bca-msg { display: grid; grid-template-rows: 0fr; margin-top: -6px; transition: grid-template-rows .3s cubic-bezier(.22,1,.36,1); }
.bca-msg[data-on="1"] { grid-template-rows: 1fr; }
/* Hidden: take back the form gap it would otherwise hold open. */
.bca-msg[data-on="0"] { margin-top: -12px; }
.bca-msg > div { overflow: hidden; }
.bca-msg p { margin: 2px 0 0; display: flex; align-items: flex-start; gap: 8px; padding: 9px 12px; border-radius: 9px;
  font-size: 12px; line-height: 1.45; color: #a3a6ad; background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); }
.bca-msg p i { flex: 0 0 auto; width: 5px; height: 5px; margin-top: 6px; border-radius: 50%; background: rgba(255,255,255,.35); }
.bca-msg[data-tone="err"] p { color: #e6aaa4; background: rgba(255,69,58,.06); border-color: rgba(255,69,58,.18); }
.bca-msg[data-tone="err"] p i { background: rgba(255,120,110,.8); }
.bca-msg[data-tone="ok"]  p i { background: var(--bca-teal); }

/* ── Submit — indigo, full width, icon + label ─────────────── */
.bca-go {
  position: relative; height: 36px; margin-top: 3px; border-radius: 9px; cursor: pointer;
  color: #e3e6ff; font: 700 13px 'DM Sans', var(--font, 'Inter', sans-serif); letter-spacing: .005em;
  background: linear-gradient(180deg, var(--bca-btn) 0%, var(--bca-btn2) 100%);
  border: 1px solid var(--bca-btn-edge);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.08), 0 10px 24px -14px rgba(52,63,142,.9);
  transition: filter .15s ease, transform .12s ease, box-shadow .2s ease;
  display: flex; align-items: center; justify-content: center; gap: 8px;
}
.bca-go:hover:not(:disabled) { filter: brightness(1.12); box-shadow: inset 0 1px 0 rgba(255,255,255,.1), 0 12px 28px -12px rgba(77,92,196,.9); }
.bca-go:active:not(:disabled) { transform: translateY(.5px); }
.bca-go:disabled { cursor: progress; }
.bca-go:focus-visible { outline: 2px solid rgba(140,160,240,.6); outline-offset: 2px; }
.bca-go-lbl { display: inline-flex; align-items: center; gap: 8px; animation: bca-lbl .26s cubic-bezier(.4,0,.2,1) both; }
.bca-go-ico { width: 12px; height: 12px; flex: 0 0 auto; opacity: .9; }
@keyframes bca-lbl { from { opacity: 0; transform: translateY(2px); } to { opacity: 1; transform: none; } }
.bca-go span { position: relative; }
.bca-spin { width: 13px; height: 13px; border-radius: 50%; border: 2px solid rgba(255,255,255,.3); border-top-color: #fff; animation: bca-rot .7s linear infinite; }
@keyframes bca-rot { to { rotate: 360deg; } }
.bca-check { width: 15px; height: 15px; }
.bca-check path { stroke-dasharray: 24; stroke-dashoffset: 24; animation: bca-draw .45s .1s cubic-bezier(.65,0,.35,1) forwards; }
@keyframes bca-draw { to { stroke-dashoffset: 0; } }

.bca-foot { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: 13px; padding-top: 11px;
  border-top: 1px solid rgba(255,255,255,.06); font-size: 11px; color: var(--bca-dim); }
.bca-link { font: 500 11px 'DM Sans', var(--font, 'Inter', sans-serif); color: #9fb4dc; background: none; border: 0; cursor: pointer;
  padding: 3px 6px; border-radius: 6px; display: inline-flex; align-items: center; gap: 4px; transition: color .15s, background .15s; }
.bca-link svg { transition: transform .2s ease; }
.bca-link:hover { color: #dbe4f7; background: rgba(255,255,255,.05); }
.bca-link:hover svg { transform: translateX(2px); }
.bca-link:focus-visible { outline: 2px solid rgba(107,143,219,.55); }

@media (max-width: 440px) {
  .bca { padding: 20px 16px; }
  .bca-body { padding: 16px 14px 12px; }
  .bca-row2 { grid-template-columns: 1fr; }
  .bca-word { font-size: 18px; }
}
@media (prefers-reduced-motion: reduce) {
  .bca *, .bca *::before, .bca *::after { animation-duration: .001s !important; animation-iteration-count: 1 !important; }
  .bca-card, .bca-word { transition: opacity .3s ease; }
  .bca[data-leaving="1"] .bca-card, .bca[data-leaving="1"] .bca-word { transform: none; }
}
html[data-motion="reduced"] .bca *, html[data-motion="reduced"] .bca *::before, html[data-motion="reduced"] .bca *::after {
  animation-duration: .001s !important; animation-iteration-count: 1 !important; }
`;
// The wordmark's Orbitron and the panel's DM Sans come from Google Fonts,
// which the app already loads Inter from. Added here so this screen stays
// self-contained.
const BCA_FONTS = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,700&family=Orbitron:wght@700&display=swap';
const ensureAuthStyles = () => {
  if (typeof document === 'undefined' || document.getElementById('bca-style')) return;
  const fl = document.createElement('link');
  fl.id = 'bca-fonts'; fl.rel = 'stylesheet'; fl.href = BCA_FONTS;
  document.head.appendChild(fl);
  const st = document.createElement('style');
  st.id = 'bca-style';
  st.textContent = BCA_CSS;
  document.head.appendChild(st);
};

// Password strength 0..4 — a guide, not a gate (the server enforces 8+).
const bcaStrength = (p) => {
  if (!p) return 0;
  let s = 0;
  if (p.length >= 8) s++;
  if (p.length >= 12) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  if (p.length < 8) s = Math.min(s, 1);
  return Math.max(1, Math.min(4, s));
};
const BCA_STRENGTH_LABEL = ['', 'Too weak', 'Fair', 'Good', 'Strong'];

const BcaField = ({id, label, type = 'text', value, onChange, autoComplete, autoFocus, disabled, invalid, ok, right, onKeyUp, inputRef, placeholder}) => (
  <div className="bca-f" data-invalid={invalid ? '1' : undefined} data-ok={ok ? '1' : undefined} data-pad={right ? '1' : undefined}>
    <label htmlFor={id} className="bca-lb">{label}</label>
    <div className="bca-box">
      <input id={id} ref={inputRef} className="bca-in" type={type} value={value} placeholder={placeholder || ''}
        onChange={e => onChange(e.target.value)} onKeyUp={onKeyUp}
        autoComplete={autoComplete} autoFocus={autoFocus} disabled={disabled}
        aria-invalid={invalid ? 'true' : undefined} spellCheck={false} autoCapitalize="off"/>
      {right}
    </div>
  </div>
);

// Bring the boot loader (BotCommand.html #bc-boot) up with a fade instead
// of the instant show() it uses on a cold start. Leaves it fully visible, so
// the app's own boot sequence simply carries on from here.
const bcaFadeInLoader = (label, ms) => {
  try {
    const el = document.getElementById('bc-boot');
    if (!el || !window.bcBoot) return;
    window.bcBoot.show(label);
    el.style.transition = 'none';
    el.style.opacity = '0';
    void el.offsetWidth;
    el.style.transition = `opacity ${ms}ms cubic-bezier(.4,0,.2,1)`;
    el.style.opacity = '1';
    setTimeout(() => { el.style.transition = ''; el.style.opacity = ''; }, ms + 60);
  } catch (_) {}
};

const LoginRegister = () => {
  ensureAuthStyles();
  // Arrived from someone's contact link: who they're about to message. That
  // is also when the Guest tab is offered (chat without an account).
  const pend = (typeof DM_PENDING !== 'undefined') ? DM_PENDING.peek() : '';
  const guestOk = !!pend && typeof GUEST !== 'undefined';
  const [mode, setMode] = React.useState(() =>
    (guestOk && DM_PENDING.wantsGuest()) ? 'guest'
      : (pend && DM_PENDING.wantsSignup && DM_PENDING.wantsSignup()) ? 'register' : 'login');   // 'login' | 'register' | 'guest'
  const [state, setState] = React.useState('idle');   // idle | busy | error | success
  const [leaving, setLeaving] = React.useState(false);
  const [err,  setErr]  = React.useState('');
  const [okMsg, setOkMsg] = React.useState('');
  const [bad, setBad] = React.useState({});            // which fields to outline
  const [showPwd, setShowPwd] = React.useState(false);
  const [caps, setCaps] = React.useState(false);
  const busy = state === 'busy' || state === 'success';

  // Login fields
  const [login, setLogin]       = React.useState('');
  const [password, setPassword] = React.useState('');
  // Register-only fields
  const [email, setEmail]       = React.useState('');
  const [username, setUsername] = React.useState('');
  const [display, setDisplay]   = React.useState('');
  // Guest-only field
  const [guestName, setGuestName] = React.useState('');

  const rootRef = React.useRef(null);
  const cardRef = React.useRef(null);
  const timers = React.useRef([]);
  React.useEffect(() => () => timers.current.forEach(clearTimeout), []);
  const later = (fn, ms) => { timers.current.push(setTimeout(fn, ms)); };
  // The entrance plays once; after it the card only moves for a state
  // change (shake on error, lift on success).
  const [entered, setEntered] = React.useState(false);
  React.useEffect(() => { const t = setTimeout(() => setEntered(true), 900); return () => clearTimeout(t); }, []);

  // Old field-specific errors don't apply to the other form.
  React.useEffect(() => { setErr(''); setBad({}); if (state === 'error') setState('idle'); }, [mode]);


  const fail = (msg, fields) => {
    setErr(msg); setBad(fields || {}); setOkMsg('');
    // Restart the shake even when failing twice in a row.
    setState('idle');
    later(() => setState('error'), 20);
    later(() => setState(s => (s === 'error' ? 'idle' : s)), 2200);
  };
  // ── HAND-OFF TO THE WORKSPACE ──────────────────────────────────
  // One continuous cross-fade: the check shows briefly, then the panel
  // fades out WHILE the boot loader fades in over it, and only once the
  // loader is fully up does the app swap in underneath. Previously the
  // panel blurred away, the screen sat empty, and the loader popped in at
  // full opacity a moment later.
  const succeed = (account, msg) => {
    setErr(''); setBad({}); setOkMsg(msg); setState('success');
    const reduced = (typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
      || document.documentElement.getAttribute('data-motion') === 'reduced';
    const FADE = reduced ? 160 : 420;
    later(() => {
      setLeaving(true);
      bcaFadeInLoader(isGuest ? 'Opening your chat…' : isLogin ? 'Signing you in…' : 'Setting up your workspace…', FADE);
    }, reduced ? 250 : 700);
    later(() => AUTH_STORE.set(account), (reduced ? 250 : 700) + FADE + 40);
  };

  const submit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (busy) return;
    setErr('');
    try {
      if (mode === 'guest') {
        if (guestName.trim().length > 60) { fail('Keep your name to 60 characters or fewer.', { guestName: true }); return; }
        setState('busy');
        let acc;
        try { acc = await GUEST.start(pend, guestName.trim()); }
        catch (ge) {
          const m = String((ge && ge.message) || 'Couldn’t start the chat. Try again.');
          // A name someone already has: point at the name field.
          fail(m, { guestName: /name/i.test(m) });
          return;
        }
        succeed(acc, 'Opening your chat…');
      } else if (mode === 'login') {
        if (!login.trim() || !password) {
          fail('Enter your email or username and password.', { login: !login.trim(), password: !password });
          return;
        }
        setState('busy');
        // The password is stretched in the browser; only a derived login key
        // is sent, and the matching message key unlocks private messages.
        const res = await DM_AUTH.signIn(login.trim(), password);
        if (!res || res.error) { fail((res && res.error) || 'Sign-in failed. Try again.', { password: true }); return; }
        succeed(res.account, 'Signed in. Opening your workspace…');
      } else {
        if (!email.trim() || !username.trim() || !password) {
          fail('Email, username and password are required.', { email: !email.trim(), username: !username.trim(), password: !password });
          return;
        }
        if (password.length < 8) { fail('Password must be at least 8 characters.', { password: true }); return; }
        setState('busy');
        const res = await DM_AUTH.register({
          email: email.trim(), username: username.trim(),
          display_name: display.trim() || username.trim(),
        }, password);
        if (!res || res.error) {
          const m = (res && res.error) || 'Couldn’t create the account. Try again.';
          fail(m, { email: /email/i.test(m), username: /user/i.test(m), password: /password/i.test(m) });
          return;
        }
        succeed(res.account, 'Workspace created. Setting things up…');
      }
    } catch (e2) {
      fail((e2 && e2.message) || 'Network error. Check your connection and try again.');
    }
  };

  const clearBad = (k) => { if (bad[k]) setBad(b => ({...b, [k]: false})); };
  const capsCheck = (e) => { try { setCaps(!!(e.getModifierState && e.getModifierState('CapsLock'))); } catch (_) {} };

  const isLogin = mode === 'login';
  const isGuest = mode === 'guest';
  const isReg = mode === 'register';
  const strength = isReg ? bcaStrength(password) : 0;
  const eye = showPwd ? (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
      <line x1="1" y1="1" x2="23" y2="23"/>
    </svg>
  ) : (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
    </svg>
  );
  const pwdField = (autoComplete) => (
    <BcaField id="bca-pwd" label="Password" placeholder={isLogin ? '••••••••' : '8+ characters'}
      type={showPwd ? 'text' : 'password'} value={password}
      onChange={v => { setPassword(v); clearBad('password'); }}
      onKeyUp={capsCheck} autoComplete={autoComplete} disabled={busy}
      invalid={bad.password} ok={isReg && strength === 4}
      right={
        <button type="button" className="bca-reveal" onClick={() => setShowPwd(s => !s)} tabIndex={0}
          aria-label={showPwd ? 'Hide password' : 'Show password'} title={showPwd ? 'Hide password' : 'Show password'}>
          {eye}
        </button>
      }/>
  );

  const btnLabel = state === 'success'
    ? <><svg className="bca-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg><span>{isLogin ? 'Welcome back' : isGuest ? 'Connected' : 'You’re in'}</span></>
    : state === 'busy'
      ? <><i className="bca-spin" aria-hidden="true"/><span>{isLogin ? 'Signing in' : isGuest ? 'Starting chat' : 'Creating workspace'}</span></>
      : isGuest
        ? <><svg className="bca-go-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22z"/></svg><span>Start Chat</span></>
      : isLogin
        ? <><svg className="bca-go-ico" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17 10V7A5 5 0 0 0 7 7v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1zM9 7a3 3 0 0 1 6 0v3H9V7z"/></svg><span>Sign In</span></>
        : <><svg className="bca-go-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M19 8v6M16 11h6"/></svg><span>Create Account</span></>;

  const msgTone = okMsg && state === 'success' ? 'ok' : (err ? 'err' : '');

  return (
    <div className="bca" ref={rootRef} data-state={state} data-leaving={leaving ? '1' : undefined}>
      {/* The app's own animated theme background (.bg-base) shows through. */}
      <div className="bca-stage">
      {/* Company name outside the panel, in translucent block letters. */}
      <div className="bca-word" role="img" aria-label="BotCommand">BotCommand</div>

      <main className="bca-card" ref={cardRef} data-entered={entered ? '1' : undefined} aria-labelledby="bca-title" aria-busy={busy ? 'true' : undefined}>
        {/* The wordmark's light, reflected along the panel's top edge. */}
        <span className="bca-glint" aria-hidden="true"><i/></span>
        <h1 id="bca-title" className="bca-sr">{isGuest ? `Message @${pend} as a guest` : isLogin ? 'Sign in to BotCommand' : 'Create your BotCommand account'}</h1>

        <div className="bca-seg" role="tablist" aria-label="Account" data-mode={mode} data-cols={guestOk ? '3' : undefined}>
          <span className="bca-seg-ind" aria-hidden="true"/>
          <button type="button" role="tab" aria-selected={isLogin} onClick={() => setMode('login')} disabled={busy}>Login</button>
          <button type="button" role="tab" aria-selected={isReg} onClick={() => setMode('register')} disabled={busy}>Register</button>
          {guestOk && <button type="button" role="tab" aria-selected={isGuest} onClick={() => setMode('guest')} disabled={busy}>Guest</button>}
        </div>

        <div className="bca-body">
        {/* Arrived from someone's contact link: say who they're about to message. */}
        {pend && isGuest ? (
          <div className="bca-to">
            <span className="bca-to-ava" aria-hidden="true" style={{background:`linear-gradient(145deg, ${typeof dmColFor === 'function' ? dmColFor(pend) : '#5ba3e8'}, color-mix(in oklab, ${typeof dmColFor === 'function' ? dmColFor(pend) : '#5ba3e8'} 55%, #15162a))`}}>
              {pend.replace(/[^A-Za-z0-9]/g, '').slice(0, 1).toUpperCase() || '@'}
            </span>
            <span className="bca-to-t">
              <span className="bca-to-l">Messaging</span>
              <span className="bca-to-n">@{pend}</span>
            </span>
          </div>
        ) : pend ? (
          <p className="bca-note">{isLogin ? 'Sign in' : 'Create an account'} to message @{pend}.</p>
        ) : null}

        <form onSubmit={submit} className="bca-form" noValidate>
          <div className="bca-swap" key={mode}>
            {isGuest ? (
              <>
                <BcaField id="bca-guest-name" label="Your name" placeholder="Optional — how they’ll see you" value={guestName}
                  onChange={v => { setGuestName(v); clearBad('guestName'); }}
                  autoComplete="name" autoFocus disabled={busy} invalid={bad.guestName}/>
                <p className="bca-fine">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
                  <span>No account needed. Your chat is end-to-end encrypted and kept on this device — create an account any time to keep it everywhere.</span>
                </p>
              </>
            ) : isLogin ? (
              <>
                <BcaField id="bca-login" label="Username or email" placeholder="your@email.com" value={login}
                  onChange={v => { setLogin(v); clearBad('login'); }}
                  autoComplete="username" autoFocus disabled={busy} invalid={bad.login}/>
                {pwdField('current-password')}
              </>
            ) : (
              <>
                <BcaField id="bca-email" type="email" label="Email" placeholder="your@email.com" value={email}
                  onChange={v => { setEmail(v); clearBad('email'); }}
                  autoComplete="email" autoFocus disabled={busy} invalid={bad.email}
                  ok={/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())}/>
                <div className="bca-row2">
                  <BcaField id="bca-user" label="Username" placeholder="yourname" value={username}
                    onChange={v => { setUsername(v); clearBad('username'); }}
                    autoComplete="username" disabled={busy} invalid={bad.username}/>
                  <BcaField id="bca-display" label="Display name" placeholder="Optional" value={display}
                    onChange={setDisplay} autoComplete="name" disabled={busy}/>
                </div>
                {pwdField('new-password')}
              </>
            )}
          </div>

          {!isGuest && (caps || (isReg && password)) && (
            <div className="bca-meta">
              {isReg && password ? (
                <>
                  <span className="bca-meter" data-s={strength} aria-hidden="true"><i/><i/><i/><i/></span>
                  <span aria-live="polite">{BCA_STRENGTH_LABEL[strength]}</span>
                </>
              ) : <span style={{flex: 1}}/>}
              {caps && (
                <span className="bca-caps">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4l7 8h-4v5H9v-5H5z"/></svg>
                  Caps Lock is on
                </span>
              )}
            </div>
          )}

          <div className="bca-msg" data-on={msgTone ? '1' : '0'} data-tone={msgTone || undefined} role={msgTone === 'err' ? 'alert' : 'status'}>
            <div>{msgTone && <p><i aria-hidden="true"/>{msgTone === 'ok' ? okMsg : err}</p>}</div>
          </div>

          <button type="submit" className="bca-go" disabled={busy}>
            <span className="bca-go-lbl" key={state === 'error' ? 'idle' : state}>{btnLabel}</span>
          </button>
        </form>

        {/* From a contact link: the other way in (guest ↔ an account). */}
        {guestOk ? (
          <div className="bca-foot">
            <span>{isGuest ? 'Have an account?' : 'No account?'}</span>
            <button type="button" className="bca-link" disabled={busy} onClick={() => setMode(isGuest ? 'login' : 'guest')}>
              {isGuest ? 'Sign in instead' : 'Continue as guest'}
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
            </button>
          </div>
        ) : (
        /* Demo entry — an explicit click, never a silent fallback: a real
            session goes straight to the app, no session lands here. */
        <div className="bca-foot">
          <span>Just looking?</span>
          <button type="button" className="bca-link" disabled={busy}
            onClick={() => succeed({ id: 0, email: 'demo@botcommand.app', username: 'demo', display_name: 'Demo' }, 'Opening the demo workspace…')}>
            Explore the demo
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
          </button>
        </div>
        )}
        </div>
      </main>
      </div>
    </div>
  );
};

// ── ACCOUNT CHIP — sits in the top bar, opens a small popover with the
// account info and a Sign Out button. Mirrors the macOS-style popover used
// elsewhere in the app for consistency.
const AccountChip = ({account, placement='down'}) => {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  React.useEffect(()=>{
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    setTimeout(()=>window.addEventListener('mousedown', h), 0);
    return ()=>window.removeEventListener('mousedown', h);
  },[open]);
  if (!account) return null;
  const initial = (account.display_name || account.username || account.email || '?')
    .trim().charAt(0).toUpperCase();
  const handleLogout = async () => {
    if (!window.confirm('Sign out of this workspace?')) return;
    setOpen(false);
    await AUTH_STORE.logout();
  };
  const up = placement === 'up';
  return (
    <div ref={ref} style={{position:'relative'}}>
      <button onClick={()=>setOpen(o=>!o)}
        title={`Signed in as ${account.username}`}
        style={{
          display:'flex',alignItems:'center',gap:6,padding:'2px 8px 2px 3px',
          borderRadius:13,fontSize:10.5,fontWeight:600,color:'var(--t1)',letterSpacing:'0.01em',
          background:open?'rgba(255,255,255,0.10)':'rgba(255,255,255,0.04)',
          border:`1px solid ${open?'rgba(255,255,255,0.16)':'rgba(255,255,255,0.08)'}`,cursor:'pointer',
          transition:'all 0.14s ease', height:22,
        }}
        onMouseEnter={e=>{ if(!open) e.currentTarget.style.background='rgba(255,255,255,0.07)'; }}
        onMouseLeave={e=>{ if(!open) e.currentTarget.style.background='rgba(255,255,255,0.04)'; }}>
        <span style={{
          width:18,height:18,borderRadius:'50%',
          background:'linear-gradient(135deg, rgba(60,62,82,0.95) 0%, rgba(40,42,62,0.95) 100%)',
          display:'flex',alignItems:'center',justifyContent:'center',
          color:'var(--t1)',fontSize:9.5,fontWeight:700,letterSpacing:0,
          border:'1px solid rgba(255,255,255,0.08)',
          flexShrink:0,
        }}>{initial}</span>
        <span style={{maxWidth:90,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{account.display_name || account.username}</span>
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" style={{opacity:0.5,transform:up?'rotate(180deg)':'none',marginLeft:-1,flexShrink:0}}>
          <polyline points="6 9 12 15 18 9"/>
        </svg>
      </button>
      {open && (
        <div style={{
          position:'absolute',
          ...(up ? {bottom:'calc(100% + 6px)'} : {top:'calc(100% + 6px)'}),
          left:0,zIndex:300,
          width:240,padding:'4px',background:'rgba(16,17,28,0.98)',
          backdropFilter:'blur(20px)',
          border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,
          boxShadow:'0 8px 32px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,255,255,0.04) inset',
        }}>
          <div style={{padding:'10px 12px 12px'}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--t1)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {account.display_name || account.username}
            </div>
            <div style={{fontSize:10.5,color:'var(--t3)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
              {account.email}
            </div>
            <div style={{fontSize:10,color:'var(--t4)',marginTop:6,fontFamily:'var(--mono)'}}>@{account.username}</div>
          </div>
          <div style={{height:1,background:'rgba(255,255,255,0.06)',margin:'2px 4px'}}/>
          <button onClick={handleLogout}
            style={{
              width:'100%',display:'flex',alignItems:'center',gap:8,
              padding:'8px 11px',fontSize:12,color:'var(--err)',
              background:'transparent',border:'none',cursor:'pointer',
              borderRadius:6,transition:'background 0.08s',textAlign:'left',
            }}
            onMouseEnter={e=>e.currentTarget.style.background='rgba(255,69,58,0.08)'}
            onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign Out
          </button>
        </div>
      )}
    </div>
  );
};