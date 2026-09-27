// ── END-USER PIPELINE PANEL — Telegram profile layout ────────
const EndUserPipelinePanel = ({convId, onClose}) => {
  const isDemo = AUTH_STORE.account && AUTH_STORE.account.email === 'demo@botcommand.app';
  const [data, setData]  = React.useState(isDemo ? DEMO_END_USER_DATA : null);
  const [tab,  setTab]   = React.useState('info');
  const [busy, setBusy]  = React.useState(false);
  const products = useProducts();

  const reload = React.useCallback(()=>{
    if (isDemo) { setData(DEMO_END_USER_DATA); return; }
    apiGet('get_end_user', `&conv_id=${encodeURIComponent(convId)}`).then(res=>{
      if (res && !res.error) setData(res);
    });
  },[convId, isDemo]);
  React.useEffect(()=>{ reload(); },[reload]);

  const eu        = data && data.end_user;
  const purchases = (data && data.purchases)    || [];
  const txs       = (data && data.transactions) || [];
  const memory    = (data && data.memory)       || {};
  const summary   = (data && data.summary)      || '';
  const stats     = (data && data.stats)        || {};
  const lt        = memory.latest_thinking      || {};

  const [editMode, setEditMode] = React.useState(false);
  const [profile, setProfile]   = React.useState({name:'',handle:'',email:'',phone:'',notes:'',verified:false});
  React.useEffect(()=>{
    if (eu) setProfile({name:eu.name||'',handle:eu.handle||'',email:eu.email||'',phone:eu.phone||'',notes:eu.notes||'',verified:!!Number(eu.verified)});
  },[eu && eu.id]);

  const saveProfile = async () => {
    if (isDemo) { setEditMode(false); return; }
    setBusy(true);
    const res = await apiFetch('save_end_user',{conv_id:convId,...profile,verified:profile.verified?1:0});
    setBusy(false);
    if (res.error) { alert(res.error); return; }
    setEditMode(false); reload();
  };
  const delPurchase = async (id) => {
    if (isDemo||!window.confirm('Remove?')) return;
    await apiFetch('delete_end_user_purchase',{id}); reload();
  };
  const delTx = async (id) => {
    if (isDemo||!window.confirm('Remove?')) return;
    await apiFetch('delete_end_user_transaction',{id}); reload();
  };

  // ── Add-purchase form state. The form lives inside the Activity tab,
  //    behind a +Add button. Username/serial fields only render when
  //    the selected product's flags say so — keeps the form compact
  //    for non-licensable items.
  const [addingPurchase, setAddingPurchase] = React.useState(false);
  const [purchaseDraft, setPurchaseDraft] = React.useState({product_id:0, expires_at:'', status:'active', serial_key:'', username:'', notes:''});
  const selectedProd = (products||[]).find(p => p.id === Number(purchaseDraft.product_id));
  const showSerialField   = selectedProd ? !!selectedProd.allowSerial   : false;
  const showUsernameField = selectedProd ? !!selectedProd.allowUsername : false;
  const submitPurchase = async () => {
    if (isDemo) { setAddingPurchase(false); return; }
    if (!eu || !eu.id) { alert('No customer record yet'); return; }
    if (!purchaseDraft.product_id) { alert('Pick a product'); return; }
    const res = await apiFetch('add_end_user_purchase', {
      end_user_id: eu.id,
      product_id:  Number(purchaseDraft.product_id),
      expires_at:  purchaseDraft.expires_at || null,
      status:      purchaseDraft.status,
      serial_key:  showSerialField   ? purchaseDraft.serial_key : '',
      username:    showUsernameField ? purchaseDraft.username   : '',
      notes:       purchaseDraft.notes,
    });
    if (res && res.error) { alert(res.error); return; }
    setAddingPurchase(false);
    setPurchaseDraft({product_id:0, expires_at:'', status:'active', serial_key:'', username:'', notes:''});
    reload();
  };
  const genSerial = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i=0;i<16;i++) bytes[i] = Math.floor(Math.random()*256);
    let out='';
    for (let i=0;i<16;i++) { if (i && i%4===0) out += '-'; out += chars[bytes[i] % chars.length]; }
    setPurchaseDraft(d => ({...d, serial_key: out}));
  };
  const resetEndUser = async () => {
    if (isDemo) return;
    if (!window.confirm('Reset ALL data for this conversation? Cannot be undone.')) return;
    setBusy(true);
    const res = await apiFetch('reset_end_user',{conv_id:convId});
    setBusy(false);
    if (res&&res.error){alert('Reset failed: '+res.error);return;}
    try{
      if(typeof MSGS_STORE!=='undefined'){
        if(MSGS_STORE.threads)MSGS_STORE.threads[convId]=[];
        const c=MSGS_STORE.list&&MSGS_STORE.list.find(m=>m.id===convId);
        if(c){c.last='';c.unread=0;c.stage='new';c.auto_reply=!!(res&&res.auto_reply);}
        MSGS_STORE.notify&&MSGS_STORE.notify();
      }
      if(typeof DRAFT_STORE!=='undefined'&&DRAFT_STORE.discard)DRAFT_STORE.discard(convId);
    }catch(e){console.warn('[reset]',e&&e.message);}
    reload();
  };

  const fmtAgo = iso => {
    if(!iso) return '—';
    const d=new Date(iso),diff=Date.now()-d.getTime();
    if(!isFinite(diff)||diff<0) return iso;
    const m=Math.round(diff/60000);if(m<1)return'just now';
    if(m<60)return `${m}m ago`;
    const h=Math.round(m/60);if(h<24)return `${h}h ago`;
    const dy=Math.round(h/24);if(dy<30)return `${dy}d ago`;
    return new Date(iso).toLocaleDateString();
  };
  const fmtDate = iso => iso?(iso+'').slice(0,10):'—';
  const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

  const STAGE_COL = {
    new:'var(--cyan)',browsing:'var(--cyan)',qualifying:'var(--warn)',considering:'var(--warn)',
    ready_to_buy:'var(--ok)',invoiced:'var(--acc)',completed:'var(--ok)',
    abandoned:'var(--t3)',objecting:'var(--err)',post_sale:'var(--ok)',
  };
  const MOOD_COL={engaged:'var(--ok)',passive:'var(--t3)',annoyed:'var(--warn)',spammy:'var(--err)'};

  const stage      = lt.current_stage || memory.stage || 'new';
  const mood       = lt.customer_mood || '';
  const trust      = Number.isFinite(memory.trust)      ? memory.trust      : null;
  const engagement = Number.isFinite(memory.engagement) ? memory.engagement : null;
  const verified   = eu && !!Number(eu.verified);
  const displayName = (eu&&((eu.name&&eu.name.trim())||(eu.handle&&eu.handle.trim())))||'Unknown';
  const initial    = displayName.charAt(0).toUpperCase();
  const totalSpend = Object.entries(stats.spend_by_currency||{}).map(([c,a])=>`${a.toLocaleString()} ${c}`).join(' · ')||null;

  // ── Telegram-style info row ──────────────────────────────
  const InfoRow = ({icon, label, value, accent, mono, last}) => {
    if (!value) return null;
    return (
      <div style={{
        display:'flex', alignItems:'center', gap:14,
        padding:'10px 16px',
        borderBottom: last ? 'none' : '1px solid var(--ln)',
        transition:'background 0.08s', cursor:'default',
      }}
      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.025)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        {/* Icon circle — Telegram style */}
        <div style={{
          width:32, height:32, borderRadius:'50%', flexShrink:0,
          background:'rgba(255,255,255,0.05)',
          border:'1px solid rgba(255,255,255,0.08)',
          display:'flex', alignItems:'center', justifyContent:'center',
          color:'var(--t2)',
        }}>{icon}</div>
        <div style={{flex:1, minWidth:0}}>
          <div style={{fontSize:12.5, color: accent||'var(--t1)', fontWeight:500,
            fontFamily: mono?'var(--mono)':'var(--font)',
            whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{value}</div>
          <div style={{fontSize:10.5, color:'var(--t3)', marginTop:1}}>{label}</div>
        </div>
      </div>
    );
  };

  // ── Section divider with label ───────────────────────────
  const Divider = ({label}) => (
    <div style={{
      padding:'10px 16px 4px',
      fontSize:10, fontWeight:600, color:'var(--t3)',
      textTransform:'uppercase', letterSpacing:'0.07em',
    }}>{label}</div>
  );

  // ── Compact KV row for AI data ───────────────────────────
  const KRow = ({label, value, accent, last}) => {
    if (!value) return null;
    return (
      <div style={{
        display:'flex', alignItems:'center', justifyContent:'space-between',
        gap:12, padding:'9px 16px',
        borderBottom: last ? 'none' : '1px solid var(--ln)',
        transition:'background 0.08s',
      }}
      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.025)'}
      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
        <span style={{fontSize:12, color:'var(--t3)', flexShrink:0, whiteSpace:'nowrap'}}>{label}</span>
        <span style={{fontSize:12, color:accent||'var(--t1)', fontWeight:500, textAlign:'right', wordBreak:'break-word', maxWidth:'55%'}}>{value}</span>
      </div>
    );
  };

  // ── Activity row ─────────────────────────────────────────
  const ActRow = ({icon, iconCol, title, sub, badge, badgeCol, onDel, last}) => (
    <div style={{
      display:'flex', alignItems:'center', gap:12, padding:'9px 16px',
      borderBottom: last?'none':'1px solid var(--ln)',
      transition:'background 0.08s',
    }}
    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.025)'}
    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
      <div style={{width:30,height:30,borderRadius:'50%',flexShrink:0,background:iconCol+'18',border:`1px solid ${iconCol}30`,display:'flex',alignItems:'center',justifyContent:'center',color:iconCol,fontSize:12}}>{icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:500,color:'var(--t1)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{title}</div>
        {sub&&<div style={{fontSize:10.5,color:'var(--t3)',marginTop:1,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{sub}</div>}
      </div>
      {badge&&<span style={{fontSize:10,fontWeight:600,padding:'2px 7px',borderRadius:6,color:badgeCol||'var(--t2)',background:(badgeCol||'var(--t2)')+'18',border:`1px solid ${badgeCol||'var(--t2)'}30`,flexShrink:0,whiteSpace:'nowrap'}}>{badge}</span>}
      {onDel&&(
        <button onClick={onDel} style={{width:18,height:18,borderRadius:4,background:'transparent',border:'none',color:'var(--t4)',cursor:'pointer',fontSize:14,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'color 0.1s'}}
          onMouseEnter={e=>e.currentTarget.style.color='var(--err)'}
          onMouseLeave={e=>e.currentTarget.style.color='var(--t4)'}>×</button>
      )}
    </div>
  );

  const TABS = [
    {id:'info',     label:'Info'},
    {id:'ai',       label:'AI'},
    {id:'activity', label:'Activity'},
  ];

  const stageCol   = STAGE_COL[stage] || 'var(--t2)';
  const moodCol    = MOOD_COL[mood]   || 'var(--t3)';
  const TX_COLS    = {completed:'var(--ok)',refunded:'var(--warn)',pending:'var(--cyan)',failed:'var(--err)'};

  return (
    <div style={{display:'flex',flexDirection:'column',height:'100%',overflow:'hidden',fontSize:13}}>

      {/* ── TELEGRAM-STYLE HERO HEADER ─────────────────────
            Full-width gradient bg, large avatar, name, handle.
            The color bleeds from the accent into the surface. */}
      <div style={{flexShrink:0, position:'relative', overflow:'hidden'}}>
        {/* Gradient backdrop */}
        <div style={{
          position:'absolute', inset:0,
          background:'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.01) 100%)',
          pointerEvents:'none',
        }}/>

        {/* Top bar with close button */}
        <div style={{
          display:'flex', alignItems:'center', justifyContent:'space-between',
          padding:'10px 12px 0', position:'relative', zIndex:1,
        }}>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            {isDemo&&<span style={{fontSize:8.5,fontWeight:700,padding:'2px 6px',borderRadius:4,background:'rgba(255,255,255,0.06)',color:'var(--t2)',border:'1px solid rgba(255,255,255,0.10)',letterSpacing:'0.07em',textTransform:'uppercase'}}>demo</span>}
          </div>
          <button onClick={onClose} className="ipc-icon-btn" style={{width:28,height:28}}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Avatar + name block */}
        <div style={{padding:'6px 16px 14px', position:'relative', zIndex:1}}>
          {/* Big avatar — uses the cached avatar_url from bc_end_users
              when available, falling back to the conversation avatar
              and finally to an initial. The end_user.avatar_url is the
              canonical source (Form1 backfills it on every inbound). */}
          <div style={{
            width:56, height:56, borderRadius:'50%', marginBottom:10,
            background:'linear-gradient(135deg, rgba(60,62,82,0.95) 0%, rgba(40,42,62,0.95) 100%)',
            display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:22, fontWeight:700, color:'var(--t1)',
            border:'1px solid rgba(255,255,255,0.10)',
            overflow:'hidden',
          }}>
            {(eu && (eu.avatar_url || (data && data.conversation && data.conversation.avatar))) ? (
              <img src={eu.avatar_url || data.conversation.avatar} alt=""
                style={{width:'100%',height:'100%',objectFit:'cover'}}
                onError={(e)=>{e.currentTarget.style.display='none';}}/>
            ) : (eu ? initial : '?')}
          </div>

          {/* Name row */}
          <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:3}}>
            <span style={{fontSize:17,fontWeight:700,color:'var(--t1)',letterSpacing:'-0.02em',lineHeight:1}}>{eu ? displayName : 'No record yet'}</span>
            {verified&&(
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style={{flexShrink:0,color:'var(--ok)'}}>
                <path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </div>

          {/* Handle / last seen */}
          <div style={{fontSize:11,color:'var(--t3)',marginBottom:8}}>
            {eu ? (
              <>
                {eu.handle && <span style={{fontFamily:'var(--mono)'}}>@{eu.handle}</span>}
                {eu.handle && stats.last_contact_at && <span style={{margin:'0 5px',opacity:0.4}}>·</span>}
                {stats.last_contact_at && <span>last seen {fmtAgo(stats.last_contact_at)}</span>}
              </>
            ) : (
              <span>The AI will build this record as the conversation progresses.</span>
            )}
          </div>

          {/* Stage + mood + scores row */}
          {eu && (
            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
              <span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,
                color:stageCol,background:stageCol+'1a',border:`1px solid ${stageCol}33`,
                textTransform:'capitalize',whiteSpace:'nowrap'}}>{stage.replace(/_/g,' ')}</span>
              {mood&&<span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,
                color:moodCol,background:moodCol+'1a',border:`1px solid ${moodCol}33`,
                textTransform:'capitalize',whiteSpace:'nowrap'}}>{mood}</span>}
              {trust!==null&&<span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,
                color:'var(--t2)',background:'rgba(255,255,255,0.06)',border:'1px solid var(--ln)',
                whiteSpace:'nowrap'}}>T:{trust}/10</span>}
              {engagement!==null&&<span style={{fontSize:10,fontWeight:600,padding:'2px 8px',borderRadius:20,
                color:'var(--t2)',background:'rgba(255,255,255,0.06)',border:'1px solid var(--ln)',
                whiteSpace:'nowrap'}}>E:{engagement}/10</span>}
            </div>
          )}
        </div>

        {/* Summary — subtle italic below header */}
        {summary && (
          <div style={{
            padding:'8px 16px 12px', fontSize:11.5, color:'var(--t2)',
            lineHeight:1.5, borderBottom:'1px solid var(--ln)',
            fontStyle:'italic', position:'relative', zIndex:1,
          }}>{summary}</div>
        )}
      </div>

      {/* ── TABS ─────────────────────────────────────────── */}
      <div style={{display:'flex',flexShrink:0,borderBottom:'1px solid var(--ln)',background:'rgba(9,10,20,0.4)'}}>
        {TABS.map(T=>(
          <button key={T.id} onClick={()=>setTab(T.id)}
            className={tab===T.id?'ftab fa':'ftab'}
            style={{flex:1,borderBottom:`2px solid ${tab===T.id?'var(--acc)':'transparent'}`,marginBottom:-1,borderRadius:0,padding:'8px 4px',textAlign:'center'}}>
            {T.label}
          </button>
        ))}
      </div>

      {/* ── SCROLLABLE CONTENT ───────────────────────────── */}
      <div style={{flex:1, overflowY:'auto'}}>
        {!data ? (
          <div style={{padding:'32px 0',textAlign:'center',color:'var(--t3)',fontSize:12}}>Loading…</div>

        ) : tab==='info' ? (
          // ── INFO TAB — Telegram-style contact rows ────────
          <>
            {/* Contact details */}
            {(eu?.email || eu?.phone || eu?.handle) && (
              <>
                <Divider label="Contact"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  <InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>} label="Email" value={eu.email}/>
                  <InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13 19.79 19.79 0 0 1 1.61 4.35 2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.91a16 16 0 0 0 6.16 6.16l.91-.91a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/></svg>} label="Phone" value={eu.phone}/>
                  <InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>} label="Username" value={bcAtHandle(eu.handle) || null} mono last/>
                </div>
              </>
            )}

            {/* Internal notes */}
            {eu?.notes && (
              <>
                <Divider label="Notes"/>
                <div style={{background:'rgba(12,13,26,0.4)',padding:'10px 16px'}}>
                  <div style={{fontSize:12,color:'var(--t2)',lineHeight:1.55}}>{eu.notes}</div>
                </div>
              </>
            )}

            {/* Stats */}
            {eu && (
              <>
                <Divider label="Activity"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  <InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>} label="Total messages" value={`${stats.total_messages||0} messages (${stats.inbound_messages||0}↓ ${stats.outbound_messages||0}↑)`}/>
                  <InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} label="First contact" value={stats.first_contact_at ? fmtDate(stats.first_contact_at) : null}/>
                  {totalSpend&&<InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>} label="Total revenue" value={totalSpend} accent="var(--ok)" last/>}
                  {!totalSpend&&<InfoRow icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>} label="Last contact" value={fmtAgo(stats.last_contact_at)} last/>}
                </div>
              </>
            )}

            {/* Edit profile button */}
            <div style={{padding:'12px 16px',display:'flex',gap:8}}>
              <button onClick={()=>setTab('edit')}
                style={{flex:1,padding:'8px 12px',fontSize:12,fontWeight:600,color:'var(--t1)',background:'var(--s3)',border:'1px solid var(--ln2)',borderRadius:8,cursor:'pointer',transition:'all 0.1s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='var(--s4)';}}
                onMouseLeave={e=>{e.currentTarget.style.background='var(--s3)';}}>
                ✎ Edit profile
              </button>
              {!isDemo&&(
                <button onClick={resetEndUser} disabled={busy}
                  style={{padding:'8px 12px',fontSize:12,fontWeight:600,color:'rgba(255,100,90,0.8)',background:'rgba(255,69,58,0.07)',border:'1px solid rgba(255,69,58,0.2)',borderRadius:8,cursor:busy?'default':'pointer',transition:'all 0.1s',whiteSpace:'nowrap'}}
                  onMouseEnter={e=>{if(!busy){e.currentTarget.style.background='rgba(255,69,58,0.14)';}}}
                  onMouseLeave={e=>{if(!busy){e.currentTarget.style.background='rgba(255,69,58,0.07)';}}}>
                  ↺ Reset
                </button>
              )}
            </div>

            {!eu&&(
              <div style={{padding:'16px',textAlign:'center',color:'var(--t3)',fontSize:11.5,lineHeight:1.5}}>
                No customer record yet.<br/>The AI builds this automatically as the conversation continues.
              </div>
            )}
          </>

        ) : tab==='ai' ? (
          // ── AI TAB ────────────────────────────────────────
          <>
            {(lt.customer_intent||lt.conversation_phase||lt.customer_mood) && (
              <>
                <Divider label="AI Snapshot · last reply"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  <KRow label="Intent"  value={lt.customer_intent}/>
                  <KRow label="Phase"   value={lt.conversation_phase?.replace(/_/g,' ')}/>
                  <KRow label="Mood"    value={lt.customer_mood ? cap(lt.customer_mood) : null} accent={lt.customer_mood?MOOD_COL[lt.customer_mood]:null}/>
                  <KRow label="Updated" value={fmtAgo(lt.updated_at)} last/>
                </div>
              </>
            )}

            {(memory.open_threads||[]).length>0&&(
              <>
                <Divider label="Open Threads"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  {(memory.open_threads||[]).map((t,i,a)=>{
                    const txt = typeof t==='string'?t:(t.q||t.text||JSON.stringify(t));
                    return <KRow key={i} label={`◎ ${i+1}`} value={txt} accent="var(--warn)" last={i===a.length-1}/>;
                  })}
                </div>
              </>
            )}

            {Object.entries(memory.facts||{}).filter(([,v])=>v!==''&&v!=null).length>0&&(
              <>
                <Divider label="Known Facts · AI discovered"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  {Object.entries(memory.facts||{}).filter(([,v])=>v!==''&&v!=null).map(([k,v],i,a)=>(
                    <KRow key={k} label={cap(k.replace(/_/g,' '))} value={String(v)} last={i===a.length-1}/>
                  ))}
                </div>
              </>
            )}

            {Object.entries(memory.prefs||{}).filter(([,v])=>v!==''&&v!=null).length>0&&(
              <>
                <Divider label="Preferences · AI observed"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  {Object.entries(memory.prefs||{}).filter(([,v])=>v!==''&&v!=null).map(([k,v],i,a)=>(
                    <KRow key={k} label={cap(k.replace(/_/g,' '))} value={String(v)} last={i===a.length-1}/>
                  ))}
                </div>
              </>
            )}

            {(Array.isArray(memory.notes)?memory.notes:[]).length>0&&(
              <>
                <Divider label="AI Notes"/>
                <div style={{background:'rgba(12,13,26,0.4)'}}>
                  {(memory.notes||[]).slice(-6).reverse().map((n,i,a)=>(
                    <div key={i} style={{padding:'9px 16px',borderBottom:i<a.length-1?'1px solid var(--ln)':'none',fontSize:12,color:'var(--t2)',lineHeight:1.5,transition:'background 0.08s'}}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.025)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>{String(n)}</div>
                  ))}
                </div>
              </>
            )}

            {(memory.signals||[]).length>0&&(
              <>
                <Divider label="Funnel Signals"/>
                <div style={{padding:'8px 16px 12px',display:'flex',flexWrap:'wrap',gap:5}}>
                  {(memory.signals||[]).slice(-16).map((s,i)=>(
                    <span key={i} style={{padding:'2px 8px',borderRadius:20,fontSize:10,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'var(--t2)',fontFamily:'var(--mono)'}}>{String(s)}</span>
                  ))}
                </div>
              </>
            )}

            {!eu&&<div style={{padding:'24px',textAlign:'center',color:'var(--t3)',fontSize:11.5}}>No AI data yet.</div>}
          </>

        ) : tab==='activity' ? (
          // ── ACTIVITY TAB ──────────────────────────────────
          <>
            <Divider label={`Purchases · ${purchases.length}`}/>
            {purchases.length===0 && !addingPurchase ?(
              <div style={{padding:'10px 16px',fontSize:12,color:'var(--t3)'}}>None recorded</div>
            ):(
              <div style={{background:'rgba(12,13,26,0.4)'}}>
                {purchases.map((p,i)=>{
                  const colMap={active:'var(--ok)',expired:'var(--err)',cancelled:'var(--t3)',suspended:'var(--warn)',pending:'var(--cyan)'};
                  const last = i===purchases.length-1 && !addingPurchase;
                  return (
                    <div key={p.id} style={{borderBottom:last?'none':'1px solid var(--ln)'}}>
                      <ActRow
                        icon="▤" iconCol={colMap[p.status]||'var(--acc)'}
                        title={p.product_name||`Product #${p.product_id}`}
                        sub={`${fmtDate(p.purchased_at)}${p.expires_at?' · exp '+fmtDate(p.expires_at):''}`}
                        badge={p.product_price||p.status} badgeCol={colMap[p.status]||'var(--t2)'}
                        onDel={!isDemo?()=>delPurchase(p.id):null}
                        last/>
                      {(p.serial_key || p.username) && (
                        <div style={{display:'flex',flexWrap:'wrap',gap:5,padding:'0 16px 9px 58px'}}>
                          {p.username && (
                            <span style={{fontSize:10,fontFamily:'var(--mono)',color:'var(--t3)',background:'rgba(255,255,255,0.04)',padding:'1px 6px',borderRadius:4,border:'1px solid rgba(255,255,255,0.06)'}}>
                              @{p.username}
                            </span>
                          )}
                          {p.serial_key && (
                            <span title="Click to copy" onClick={()=>navigator.clipboard?.writeText(p.serial_key)}
                              style={{fontSize:10,fontFamily:'var(--mono)',color:'var(--t3)',background:'rgba(255,255,255,0.04)',padding:'1px 6px',borderRadius:4,border:'1px solid rgba(255,255,255,0.06)',cursor:'pointer',maxWidth:200,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                              🔑 {p.serial_key}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Inline add-purchase form. Only the fields the chosen
                    product asks for are rendered (allowSerial /
                    allowUsername toggles), keeping the form compact. */}
                {addingPurchase && (
                  <div style={{padding:'10px 16px',display:'flex',flexDirection:'column',gap:8,background:'rgba(108,99,255,0.04)',borderTop:'1px solid var(--ln)'}}>
                    <select className="fi" value={purchaseDraft.product_id} onChange={e=>setPurchaseDraft(d=>({...d,product_id:e.target.value}))} style={{fontSize:12}}>
                      <option value={0}>Select product…</option>
                      {(products||[]).map(p => (
                        <option key={p.id} value={p.id}>{p.name} {p.sku?`(${p.sku})`:''}</option>
                      ))}
                    </select>
                    <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6}}>
                      <select className="fi" value={purchaseDraft.status} onChange={e=>setPurchaseDraft(d=>({...d,status:e.target.value}))} style={{fontSize:12}}>
                        <option value="active">Active</option>
                        <option value="pending">Pending</option>
                        <option value="suspended">Suspended</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                      <input className="fi" type="date" value={purchaseDraft.expires_at} onChange={e=>setPurchaseDraft(d=>({...d,expires_at:e.target.value}))} style={{fontSize:12}}/>
                    </div>
                    {showUsernameField && (
                      <input className="fi" placeholder="Bound username" value={purchaseDraft.username} onChange={e=>setPurchaseDraft(d=>({...d,username:e.target.value}))} style={{fontSize:12}}/>
                    )}
                    {showSerialField && (
                      <div style={{display:'flex',gap:6}}>
                        <input className="fi" placeholder="Serial key" value={purchaseDraft.serial_key} onChange={e=>setPurchaseDraft(d=>({...d,serial_key:e.target.value}))} style={{fontSize:12,fontFamily:'var(--mono)',flex:1}}/>
                        <button onClick={genSerial} style={{padding:'0 10px',fontSize:10,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.10)',borderRadius:6,cursor:'pointer'}}>Gen</button>
                      </div>
                    )}
                    <div style={{display:'flex',gap:6,justifyContent:'flex-end'}}>
                      <button onClick={()=>{setAddingPurchase(false);}} className="gbtn" style={{padding:'5px 12px',fontSize:11}}>Cancel</button>
                      <button onClick={submitPurchase} className="abtn" style={{padding:'5px 14px',fontSize:11,fontWeight:600}}>Add</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!addingPurchase && !isDemo && (
              <div style={{padding:'6px 16px 4px'}}>
                <button onClick={()=>setAddingPurchase(true)} style={{width:'100%',padding:'7px',fontSize:11,fontWeight:600,color:'var(--t2)',background:'rgba(255,255,255,0.025)',border:'1px dashed rgba(255,255,255,0.12)',borderRadius:7,cursor:'pointer'}}>+ Add purchase</button>
              </div>
            )}

            <Divider label={`Transactions · ${txs.length}`}/>
            {txs.length===0?(
              <div style={{padding:'10px 16px',fontSize:12,color:'var(--t3)'}}>None recorded</div>
            ):(
              <div style={{background:'rgba(12,13,26,0.4)'}}>
                {txs.map((t,i)=>{
                  const tc={completed:'var(--ok)',refunded:'var(--warn)',pending:'var(--cyan)',failed:'var(--err)'};
                  return <ActRow key={t.id}
                    icon="◈" iconCol={tc[t.status]||'var(--t2)'}
                    title={`${t.currency} ${parseFloat(t.amount).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`}
                    sub={`${t.product_name?t.product_name+' · ':''}${fmtDate(t.created_at)}${t.reference?' · '+t.reference:''}`}
                    badge={cap(t.status)} badgeCol={tc[t.status]||'var(--t2)'}
                    onDel={!isDemo?()=>delTx(t.id):null}
                    last={i===txs.length-1}/>;
                })}
                {totalSpend&&(
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'9px 16px',borderTop:'1px solid var(--ln)',background:'rgba(48,209,88,0.04)'}}>
                    <span style={{fontSize:11,color:'var(--t3)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.07em'}}>Total revenue</span>
                    <span style={{fontSize:13,fontWeight:700,color:'var(--ok)',fontFamily:'var(--mono)'}}>{totalSpend}</span>
                  </div>
                )}
              </div>
            )}
            <div style={{height:16}}/>
          </>

        ) : (
          // ── EDIT PROFILE TAB ──────────────────────────────
          <div style={{padding:'12px 16px',display:'flex',flexDirection:'column',gap:12}}>
            {isDemo&&(
              <div style={{padding:'8px 11px',borderRadius:7,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',fontSize:11,color:'var(--t2)',lineHeight:1.4}}>
                Demo mode — edits not saved
              </div>
            )}
            <div style={{background:'rgba(12,13,26,0.52)',backdropFilter:'blur(20px)',WebkitBackdropFilter:'blur(20px)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:10,overflow:'hidden'}}>
              {[
                {label:'Name',   field:'name',   type:'text'},
                {label:'Handle', field:'handle', type:'text'},
                {label:'Email',  field:'email',  type:'email'},
                {label:'Phone',  field:'phone',  type:'tel'},
              ].map(({label,field,type},i,a)=>(
                <div key={field} style={{display:'flex',alignItems:'center',gap:12,padding:'9px 14px',borderBottom:i<a.length-1?'1px solid var(--ln)':'none'}}>
                  <span style={{fontSize:11,color:'var(--t3)',minWidth:52,flexShrink:0}}>{label}</span>
                  <input type={type} value={profile[field]} onChange={e=>setProfile({...profile,[field]:e.target.value})} disabled={isDemo}
                    style={{flex:1,background:'transparent',border:'none',outline:'none',fontSize:13,color:'var(--t1)',fontFamily:'var(--font)',padding:'1px 0'}}/>
                </div>
              ))}
            </div>
            <textarea value={profile.notes} onChange={e=>setProfile({...profile,notes:e.target.value})}
              disabled={isDemo} placeholder="Internal notes…" className="fi fta" style={{fontSize:12,minHeight:64,resize:'vertical'}}/>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12.5,color:'var(--t2)',cursor:isDemo?'default':'pointer'}}>
              <input type="checkbox" checked={profile.verified} onChange={e=>setProfile({...profile,verified:e.target.checked})} disabled={isDemo} style={{accentColor:'var(--acc)',width:13,height:13}}/>
              Verified customer
              {profile.verified&&<span style={{fontSize:10.5,color:'var(--ok)',fontWeight:600}}>✓</span>}
            </label>
            <div style={{display:'flex',gap:8}}>
              <button onClick={()=>setTab('info')} className="gbtn" style={{flex:1}}>Cancel</button>
              <button onClick={saveProfile} disabled={busy||isDemo} className="abtn" style={{flex:2,padding:'8px',fontSize:12,fontWeight:600,opacity:(busy||isDemo)?0.5:1,cursor:(busy||isDemo)?'default':'pointer'}}>
                {busy?'Saving…':'Save'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
