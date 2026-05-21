/* ============ State ============ */
var DEFAULT_ANCHOR = '5163 Roswell Rd, Atlanta, GA 30342';
var state = {
  apiKey:'', model:'gemini-2.5-flash', anchor:DEFAULT_ANCHOR,
  homes:[], sortBy:'price_asc', modalEditId:null
};

var NEIGHBORHOODS = [
  {name:'Sandy Springs', zips:'30328, 30342, 30350', mins:'5-15 min', note:'Surrounds the anchor address — the closest option.'},
  {name:'Dunwoody', zips:'30338, 30346', mins:'10-20 min', note:'Strong schools, Brook Run Park, MARTA access.'},
  {name:'Brookhaven', zips:'30319', mins:'10-20 min', note:'Walkable pockets, Murphey Candler Park, lively dining.'},
  {name:'Chamblee', zips:'30341', mins:'15-25 min', note:'Up-and-coming, good value, MARTA station.'},
  {name:'Roswell', zips:'30075, 30076', mins:'15-25 min', note:'Historic district and Chattahoochee River trails.'},
  {name:'Vinings', zips:'30339', mins:'15-25 min', note:'Upscale, riverside, easy I-285 access.'},
  {name:'Smyrna', zips:'30080, 30082', mins:'20-30 min', note:'Market Village, newer builds, solid value.'},
  {name:'East Cobb', zips:'30062, 30068', mins:'20-30 min', note:'Top-rated schools and larger, leafier lots.'},
  {name:'Marietta', zips:'30060, 30064, 30067', mins:'25-35 min', note:'Historic square — more land and house for the money.'}
];

var PALETTE = [['#fef3c7','#92400e'],['#dbeafe','#1e3a8a'],['#dcfce7','#14532d'],
  ['#fce7f3','#9d174d'],['#e0e7ff','#3730a3'],['#ffedd5','#9a3412'],
  ['#cffafe','#155e75'],['#f3e8ff','#6b21a8'],['#fee2e2','#991b1b'],['#d1fae5','#065f46']];

/* ============ Helpers ============ */
function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){
  return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
function hashStr(s){var h=0;for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;}return Math.abs(h);}
function badgeColor(label){var p=PALETTE[hashStr(String(label||''))%PALETTE.length];return{bg:p[0],fg:p[1]};}
function fmtPrice(p){return p?'$'+Number(p).toLocaleString('en-US'):'—';}
function parsePrice(s){var n=parseInt(String(s||'').replace(/[^0-9]/g,''),10);return isNaN(n)?null:n;}
function parseNum(s){var n=parseFloat(String(s||''));return isNaN(n)?null:n;}
function prettyKey(k){return String(k).replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
function el(id){return document.getElementById(id);}
function setVal(id,v){var e=el(id);if(e)e.value=v==null?'':v;}

/* ============ Persistence ============ */
function loadState(){
  try{
    state.apiKey = localStorage.getItem('hsa_apiKey')||'';
    state.model  = localStorage.getItem('hsa_model')||'gemini-2.5-flash';
    state.anchor = localStorage.getItem('hsa_anchor')||DEFAULT_ANCHOR;
    var h = localStorage.getItem('hsa_homes');
    var homes = h ? JSON.parse(h) : [];
    // Migrate old homes (no status) — they were saved intentionally, treat as liked
    homes.forEach(function(hm){ if(!hm.status) hm.status = 'liked'; });
    state.homes = homes;
  }catch(e){ state.homes = []; }
}
function saveHomes(){
  var clean = state.homes.map(function(h){
    var o={};
    for(var k in h){ if(h.hasOwnProperty(k) && k.charAt(0)!=='_') o[k]=h[k]; }
    return o;
  });
  localStorage.setItem('hsa_homes', JSON.stringify(clean));
}

/* ============ Navigation ============ */
function showSection(name){
  var secs=document.querySelectorAll('.section');
  for(var i=0;i<secs.length;i++) secs[i].classList.toggle('active', secs[i].id==='sec-'+name);
  var navs=document.querySelectorAll('.nav-item[data-sec]');
  for(var j=0;j<navs.length;j++) navs[j].classList.toggle('active', navs[j].getAttribute('data-sec')===name);
}

/* ============ Settings drawer ============ */
function openDrawer(){
  setVal('set_key',state.apiKey); setVal('set_model',state.model); setVal('set_anchor',state.anchor);
  el('drawer').classList.add('open'); el('drawerOverlay').classList.add('show');
  el('setSaved').style.display='none';
}
function closeDrawer(){el('drawer').classList.remove('open'); el('drawerOverlay').classList.remove('show');}
function toggleKey(){var i=el('set_key'); i.type = i.type==='password'?'text':'password';}
function saveSettings(){
  state.apiKey = el('set_key').value.trim();
  state.model  = el('set_model').value.trim()||'gemini-2.5-flash';
  state.anchor = el('set_anchor').value.trim()||DEFAULT_ANCHOR;
  localStorage.setItem('hsa_apiKey', state.apiKey);
  localStorage.setItem('hsa_model',  state.model);
  localStorage.setItem('hsa_anchor', state.anchor);
  el('setSaved').style.display='block';
  el('sbAnchor').textContent = state.anchor;
  renderNeighborhoods();
}

/* ============ Gemini API ============ */
function buildPrompt(i){
  // Build text to analyze: prefer rawText, fall back to desc + known fields
  var text = '';
  if(i.rawText && i.rawText.length > 40){
    text = i.rawText.slice(0, 9000); // cap to keep tokens reasonable
  } else {
    if(i.address) text += 'Address: '+i.address+'\n';
    if(i.price)   text += 'Price: $'+Number(i.price).toLocaleString('en-US')+'\n';
    if(i.desc)    text += '\nDescription:\n'+i.desc;
    if(!text)     text = '(No listing text provided)';
  }

  return 'You are an expert real estate scout helping a buyer find a home near Atlanta, GA.\n\n'
    +'BUYER CRITERIA\n'
    +'- Budget: under $700,000\n'
    +'- Must-haves: basement (finished or unfinished); decent usable backyard\n'
    +'- Strong preferences: pool; creek or stream on the property\n\n'
    +'YOUR TASK — from the listing text below:\n'
    +'1. EXTRACT the key facts: address, list price, beds, baths, sqft.\n'
    +'2. FIND "X-factors" — standout or unusual features: creek/stream/pond, pool, large lot, sunroom, '
    +'workshop/studio, lake access, treehouse, covered outdoor living, exceptional views, unique architecture, '
    +'detached garage/ADU, chef\'s kitchen, finished basement extras, etc.\n'
    +'3. SCORE the buyer\'s must-have criteria.\n\n'
    +'For every X-factor give a ONE-LINE reason quoting evidence from the text.\n\n'
    +'LISTING URL (reference only): '+(i.url||'(none)')+'\n\n'
    +'LISTING TEXT:\n"""\n'+text+'\n"""\n\n'
    +'Return ONLY valid JSON with exactly this shape — no markdown, no prose:\n'
    +'{\n'
    +'  "extracted": {\n'
    +'    "address": "full street address with city, state, zip",\n'
    +'    "price": 625000,\n'
    +'    "beds": 4,\n'
    +'    "baths": 2.5,\n'
    +'    "sqft": 2800\n'
    +'  },\n'
    +'  "x_factors": [\n'
    +'    { "label": "Creek", "emoji": "💧", "reason": "Listing mentions a running creek along the rear property line" }\n'
    +'  ],\n'
    +'  "criteria_scores": {\n'
    +'    "price": "Under budget — listed at $X vs $700k limit",\n'
    +'    "basement": "Yes — listing states full unfinished basement",\n'
    +'    "backyard": "Large — described as half-acre flat lot"\n'
    +'  },\n'
    +'  "vibe_summary": "2-3 sentences on what makes this home special, or why it falls flat"\n'
    +'}\n\n'
    +'Notes: extracted.price must be a plain number (e.g. 625000), not a string. '
    +'Use null for any extracted field you cannot find. '
    +'If info is sparse, return empty x_factors array and Unknown for criteria scores.';
}

function extractJsonObject(text){
  var t=text.trim(), start=t.indexOf('{');
  if(start===-1) throw new Error('No JSON object found in response');
  var depth=0, inStr=false, esc2=false;
  for(var i=start;i<t.length;i++){
    var c=t[i];
    if(inStr){ if(esc2)esc2=false; else if(c==='\\')esc2=true; else if(c==='"')inStr=false; }
    else{ if(c==='"')inStr=true; else if(c==='{')depth++; else if(c==='}'){depth--;if(depth===0)return t.slice(start,i+1);} }
  }
  throw new Error('Incomplete JSON in response');
}

function parseAnalysis(text){
  var raw;
  try{ raw = JSON.parse(extractJsonObject(text)); }
  catch(e){ throw new Error('Could not parse the AI response as JSON.\n\nRaw:\n'+text.slice(0,400)); }

  var ex = raw.extracted || {};
  var xf = Array.isArray(raw.x_factors) ? raw.x_factors.map(function(f){
    return {label:String(f.label||'Feature'), emoji:String(f.emoji||'✨'), reason:String(f.reason||'')};
  }) : [];

  return {
    extracted:{
      address: String(ex.address||''),
      price:   typeof ex.price==='number' ? ex.price : parsePrice(ex.price),
      beds:    typeof ex.beds==='number'  ? ex.beds  : parseNum(ex.beds),
      baths:   typeof ex.baths==='number' ? ex.baths : parseNum(ex.baths),
      sqft:    typeof ex.sqft==='number'  ? ex.sqft  : parseNum(ex.sqft)
    },
    x_factors: xf,
    criteria_scores: (raw.criteria_scores && typeof raw.criteria_scores==='object') ? raw.criteria_scores : {},
    vibe_summary: String(raw.vibe_summary||''),
    analyzedAt: new Date().toISOString()
  };
}

function callAI(i){
  if(!state.apiKey) return Promise.reject(new Error(
    'No API key set.\n\nOpen ⚙️ Settings (bottom-left) and paste your free Gemini key from aistudio.google.com/apikey'));
  var model = state.model || 'gemini-2.5-flash';
  var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
    +encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(state.apiKey);
  var body = {
    contents:[{parts:[{text:buildPrompt(i)}]}],
    generationConfig:{responseMimeType:'application/json', maxOutputTokens:2000}
  };
  return fetch(endpoint,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})
    .then(function(res){
      if(!res.ok){
        return res.text().then(function(txt){
          var msg=txt;
          try{var j=JSON.parse(txt);if(j.error&&j.error.message)msg=j.error.message;}catch(e){}
          throw new Error('Gemini API '+res.status+': '+msg);
        });
      }
      return res.json();
    }, function(netErr){ throw new Error('Network error: '+netErr.message); })
    .then(function(data){
      var candidates = data.candidates||[];
      if(!candidates.length) throw new Error('Gemini returned no candidates. Check your API key and model name in Settings.');
      var pts = (candidates[0].content||{}).parts||[];
      var text = pts.map(function(p){return p.text||'';}).join('').trim();
      if(!text) throw new Error('Gemini returned an empty response.');
      return parseAnalysis(text);
    });
}

/* ============ Home objects ============ */
function newHome(i){
  return {
    id: 'h'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36),
    address: i.address||'', price: i.price||null,
    url: i.url||'', rawText: i.rawText||'',
    notes: i.notes||'', desc: i.desc||'',
    beds: i.beds!=null?i.beds:null, baths: i.baths!=null?i.baths:null, sqft: i.sqft||null,
    status: 'pending',
    analysis: null, createdAt: new Date().toISOString()
  };
}
function xCount(h){return (h.analysis&&h.analysis.x_factors)?h.analysis.x_factors.length:0;}
function findHome(id){ for(var i=0;i<state.homes.length;i++) if(state.homes[i].id===id) return state.homes[i]; return null; }
function deleteHome(id){
  var h=findHome(id); if(!h) return;
  if(!confirm('Remove "'+(h.address||'this listing')+'"?')) return;
  state.homes=state.homes.filter(function(x){return x.id!==id;});
  saveHomes(); updateCounts(); renderDiscover(); renderHomes();
}

/* ============ Add Listing ============ */
function submitAddListing(){
  var url     = el('add_url').value.trim();
  var rawText = el('add_rawText').value.trim();
  var btn     = el('addAnalyzeBtn');

  if(!rawText){ showAddError('Please paste the listing text first.'); return; }
  if(!state.apiKey){ showAddError('Please add your free Gemini API key in ⚙️ Settings first.'); return; }
  showAddError('');

  // Add home immediately with pending status
  var home = newHome({url:url, rawText:rawText});
  state.homes.push(home);
  saveHomes();

  // Switch to Discover, reset form
  el('add_url').value = '';
  el('add_rawText').value = '';
  btn.disabled = true; btn.textContent = 'Analyzing…';
  showSection('discover');
  home._analyzing = true;
  renderDiscover(); updateCounts();

  callAI({url:url, rawText:rawText})
    .then(function(analysis){
      home.analysis = analysis;
      var ex = analysis.extracted || {};
      if(ex.address)          home.address = ex.address;
      if(ex.price)            home.price   = ex.price;
      if(ex.beds   != null)   home.beds    = ex.beds;
      if(ex.baths  != null)   home.baths   = ex.baths;
      if(ex.sqft   != null)   home.sqft    = ex.sqft;
      delete home._error;
    })
    .catch(function(e){ home._error = e.message; })
    .then(function(){
      home._analyzing = false;
      btn.disabled = false; btn.textContent = '✨ Analyze & Add to Queue';
      saveHomes(); renderDiscover(); updateCounts();
    });
}

function showAddError(msg){
  var e=el('addError');
  if(msg){e.textContent=msg;e.style.display='';}else{e.style.display='none';}
}

/* ============ Rating ============ */
function rateHome(id, status){
  var home = findHome(id); if(!home) return;
  home.status = status;
  saveHomes(); renderDiscover(); renderHomes(); updateCounts();
}

/* ============ Re-analyze ============ */
function analyzeHome(id){
  var home=findHome(id); if(!home) return;
  var raw = home.rawText || home.desc || '';
  home._analyzing = true; renderHomes();
  callAI({url:home.url, rawText:raw, address:home.address, price:home.price, desc:raw})
    .then(function(analysis){
      home.analysis = analysis;
      var ex = analysis.extracted||{};
      if(ex.address && !home.address) home.address = ex.address;
      if(ex.price   && !home.price)   home.price   = ex.price;
      if(ex.beds  != null && !home.beds)  home.beds  = ex.beds;
      if(ex.baths != null && !home.baths) home.baths = ex.baths;
      if(ex.sqft  != null && !home.sqft)  home.sqft  = ex.sqft;
    })
    .catch(function(e){ alert('Analysis failed:\n\n'+e.message); })
    .then(function(){ home._analyzing=false; saveHomes(); renderHomes(); });
}

function retryAnalysis(id){
  var home=findHome(id); if(!home) return;
  delete home._error;
  home._analyzing = true;
  renderDiscover();
  var raw = home.rawText || home.desc || '';
  callAI({url:home.url, rawText:raw, address:home.address, price:home.price, desc:raw})
    .then(function(analysis){
      home.analysis = analysis;
      var ex = analysis.extracted||{};
      if(ex.address) home.address = ex.address;
      if(ex.price)   home.price   = ex.price;
      if(ex.beds   != null) home.beds  = ex.beds;
      if(ex.baths  != null) home.baths = ex.baths;
      if(ex.sqft   != null) home.sqft  = ex.sqft;
      delete home._error;
    })
    .catch(function(e){ home._error = e.message; })
    .then(function(){ home._analyzing=false; saveHomes(); renderDiscover(); updateCounts(); });
}

/* ============ Counts ============ */
function updateCounts(){
  var pending = state.homes.filter(function(h){ return !h.status||h.status==='pending'; });
  var saved   = state.homes.filter(function(h){ return h.status==='liked'||h.status==='loved'; });
  el('discoverCount').textContent = pending.length || '';
  el('homesCount').textContent    = saved.length   || '';
}

/* ============ Rendering: analysis blocks ============ */
function xfactorRowHtml(f){
  var c=badgeColor(f.label);
  return '<div class="xrow"><span class="badge" style="background:'+c.bg+';color:'+c.fg+'">'
    +esc(f.emoji)+' '+esc(f.label)+'</span><span class="xreason">'+esc(f.reason)+'</span></div>';
}
function pillHtml(f){
  var c=badgeColor(f.label);
  return '<span class="badge sm" style="background:'+c.bg+';color:'+c.fg+'" title="'+esc(f.reason)+'">'
    +esc(f.emoji)+' '+esc(f.label)+'</span>';
}
function analysisHtml(a){
  if(!a) return '';
  var h='';
  if(a.vibe_summary) h+='<div class="vibe">'+esc(a.vibe_summary)+'</div>';
  var n=(a.x_factors&&a.x_factors.length)?a.x_factors.length:0;
  h+='<span class="block-label">✨ X-Factors'+(n?' ('+n+')':'')+'</span>';
  if(n){ h+='<div class="xfactors">'+a.x_factors.map(xfactorRowHtml).join('')+'</div>'; }
  else{ h+='<div class="muted-note">No standout X-factors detected.</div>'; }
  var cs=a.criteria_scores||{}, keys=Object.keys(cs);
  if(keys.length){
    h+='<span class="block-label">📋 Baseline Criteria</span><div class="criteria">';
    h+=keys.map(function(k){
      return '<div class="crit"><div class="crit-k">'+esc(prettyKey(k))+'</div>'
        +'<div class="crit-v">'+esc(String(cs[k]))+'</div></div>';
    }).join('');
    h+='</div>';
  }
  return h;
}

/* ============ Criteria chips (Discover) ============ */
function criteriaChipsHtml(cs){
  if(!cs||!Object.keys(cs).length) return '';
  var chips = Object.keys(cs).map(function(k){
    var val   = String(cs[k]||'');
    var lower = val.toLowerCase();
    var cls   = 'chip-neutral';
    if(/\byes\b/.test(lower) || /under budget|within budget|meets/.test(lower)) cls='chip-good';
    else if(/\bno\b/.test(lower) || /unknown|not found|not mentioned|over budget|n\/a/.test(lower)) cls='chip-bad';
    return '<span class="crit-chip '+cls+'">'+esc(prettyKey(k))+': '+esc(val.slice(0,60))+'</span>';
  });
  return '<div class="disc-criteria">'+chips.join('')+'</div>';
}

/* ============ Rendering: Discover ============ */
function renderDiscover(){
  var pending = state.homes.filter(function(h){ return !h.status||h.status==='pending'; });
  var list = el('discoverList');
  if(!pending.length){
    list.innerHTML = '<div class="empty">No listings in your queue yet.<br/><br/>'
      +'Click <b>＋ Add Listing</b> in the sidebar, paste the full text from a Zillow or Redfin page, '
      +'and the AI will analyze it here.</div>';
    return;
  }
  list.innerHTML = pending.map(discoverCardHtml).join('');
}

function discoverCardHtml(h){
  if(h._analyzing){
    return '<div class="card disc-card disc-loading" data-id="'+h.id+'">'
      +'<div class="disc-loading-inner">'
      +'<div class="loading-dots"><span></span><span></span><span></span></div>'
      +'<div class="loading-msg">Analyzing listing with AI…</div>'
      +(h.url?'<div class="loading-sub"><a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">'
          +esc(h.url.replace(/^https?:\/\/(www\.)?/,'').slice(0,70))+'</a></div>':'')
      +'</div></div>';
  }

  if(h._error){
    return '<div class="card disc-card" data-id="'+h.id+'">'
      +'<div class="error">⚠️ Analysis failed: '+esc(h._error)+'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px">'
      +'<button class="btn tiny primary" data-action="retry" data-id="'+h.id+'">↻ Retry</button>'
      +'<button class="btn tiny danger"  data-action="delete" data-id="'+h.id+'">Remove</button>'
      +'</div></div>';
  }

  var a  = h.analysis || {};
  var xf = a.x_factors || [];
  var cs = a.criteria_scores || {};

  var specsHtml = '';
  if(h.beds!=null||h.baths!=null||h.sqft){
    specsHtml = '<div class="disc-specs">'
      +(h.beds  !=null?'<span class="spec-chip">🛏 '+h.beds+' bd</span>':'')
      +(h.baths !=null?'<span class="spec-chip">🛁 '+h.baths+' ba</span>':'')
      +(h.sqft        ?'<span class="spec-chip">📐 '+Number(h.sqft).toLocaleString()+' sqft</span>':'')
      +'</div>';
  }

  return '<div class="card disc-card" data-id="'+h.id+'">'
    +'<div class="disc-head">'
      +'<div class="disc-addr">'+(h.address?esc(h.address):'<em style="color:var(--muted);font-style:normal">Address not extracted</em>')+'</div>'
      +(h.price?'<div class="price-tag">'+fmtPrice(h.price)+'</div>':'')
    +'</div>'
    +specsHtml
    +(a.vibe_summary?'<div class="vibe">'+esc(a.vibe_summary)+'</div>':'')
    +(xf.length?'<div class="disc-xf">'+xf.map(pillHtml).join(' ')+'</div>':'')
    +criteriaChipsHtml(cs)
    +(h.url?'<div style="margin-top:8px"><a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">View listing ↗</a></div>':'')
    +'<div class="disc-actions">'
      +'<button class="btn pass" data-action="pass" data-id="'+h.id+'">❌ Pass</button>'
      +'<button class="btn like" data-action="like" data-id="'+h.id+'">👍 Like</button>'
      +'<button class="btn love" data-action="love" data-id="'+h.id+'">❤️ Love it</button>'
    +'</div>'
  +'</div>';
}

/* ============ Rendering: Saved Homes ============ */
function sortedSaved(){
  var hs = state.homes.filter(function(h){ return h.status==='liked'||h.status==='loved'; });
  var by = state.sortBy;
  hs.sort(function(a,b){
    if(by==='xfactors')   return xCount(b)-xCount(a);
    if(by==='price_desc') return (b.price||-1)-(a.price||-1);
    return (a.price==null?Infinity:a.price)-(b.price==null?Infinity:b.price);
  });
  return hs;
}
function homeCardHtml(h){
  var a = h.analysis;
  var statusBadge = h.status==='loved'
    ? '<span class="status-love">❤️ Love it</span>'
    : '<span class="status-like">👍 Like</span>';
  var specsHtml = '';
  if(h.beds!=null||h.baths!=null||h.sqft){
    specsHtml = '<div class="disc-specs" style="margin:6px 0 0">'
      +(h.beds  !=null?'<span class="spec-chip">🛏 '+h.beds+' bd</span>':'')
      +(h.baths !=null?'<span class="spec-chip">🛁 '+h.baths+' ba</span>':'')
      +(h.sqft        ?'<span class="spec-chip">📐 '+Number(h.sqft).toLocaleString()+' sqft</span>':'')
      +'</div>';
  }
  return '<div class="card home-card">'
    +'<div class="home-top"><div style="flex:1;min-width:0">'
      +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">'
        +statusBadge
        +(h.url?'<a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">View listing ↗</a>':'')
      +'</div>'
      +'<div class="home-addr">'+esc(h.address||'(no address)')+'</div>'
      +specsHtml
    +'</div>'
    +(h.price?'<div class="price-tag">'+fmtPrice(h.price)+'</div>':'')
    +'</div>'
    +(a?analysisHtml(a):'<div class="muted-note">Not analyzed yet.</div>')
    +(h.notes?'<div class="home-notes">📝 '+esc(h.notes)+'</div>':'')
    +'<div class="card-actions">'
      +'<button class="btn tiny outline" data-action="queue"   data-id="'+h.id+'">↩ Back to Queue</button>'
      +'<button class="btn tiny primary"'+(h._analyzing?' disabled':'')+' data-action="analyze" data-id="'+h.id+'">'
        +(h._analyzing?'Analyzing…':(a?'↻ Re-analyze':'✨ Analyze'))+'</button>'
      +'<button class="btn tiny outline" data-action="edit"    data-id="'+h.id+'">Edit</button>'
      +'<button class="btn tiny danger"  data-action="delete"  data-id="'+h.id+'">Delete</button>'
    +'</div>'
  +'</div>';
}
function renderHomes(){
  var homes = sortedSaved();
  el('homesCount').textContent = homes.length||'';
  if(!homes.length){
    el('homesCards').innerHTML = '<div class="empty">No saved homes yet.<br/><br/>'
      +'Rate listings as <b>👍 Like</b> or <b>❤️ Love it</b> in the Discover queue to save them here.</div>';
    return;
  }
  el('homesCards').innerHTML = homes.map(homeCardHtml).join('');
}
function setSort(v){ state.sortBy=v; renderHomes(); }

/* ============ Edit modal ============ */
function openModal(id){
  state.modalEditId = id||null;
  var h = id ? findHome(id) : null;
  el('modalTitle').textContent = 'Edit Home';
  setVal('md_address', h ? h.address : '');
  setVal('md_price',   h ? (h.price||'') : '');
  setVal('md_url',     h ? h.url : '');
  setVal('md_beds',    h && h.beds  !=null ? h.beds  : '');
  setVal('md_baths',   h && h.baths !=null ? h.baths : '');
  setVal('md_sqft',    h ? (h.sqft||'') : '');
  setVal('md_notes',   h ? h.notes : '');
  el('modalOverlay').classList.add('show');
}
function closeModal(){ el('modalOverlay').classList.remove('show'); state.modalEditId=null; }
function saveModal(){
  if(!state.modalEditId) return;
  var home = findHome(state.modalEditId); if(!home) return;
  home.address = el('md_address').value.trim();
  home.price   = parsePrice(el('md_price').value) || home.price;
  home.url     = el('md_url').value.trim();
  home.beds    = parseNum(el('md_beds').value);
  home.baths   = parseNum(el('md_baths').value);
  home.sqft    = parseNum(el('md_sqft').value);
  home.notes   = el('md_notes').value.trim();
  saveHomes(); renderHomes(); closeModal();
}

/* ============ Neighborhoods & Search ============ */
function renderNeighborhoods(){
  el('nbAnchor').textContent = state.anchor;
  el('nbList').innerHTML = NEIGHBORHOODS.map(function(n){
    var link = 'https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(state.anchor)
      +'&destination='+encodeURIComponent(n.name+', GA');
    return '<div class="card nb-card">'
      +'<div class="nb-top"><h3>'+esc(n.name)+'</h3><span class="nb-mins">'+esc(n.mins)+'</span></div>'
      +'<div class="nb-zips">ZIP: '+esc(n.zips)+'</div>'
      +'<div class="nb-note">'+esc(n.note)+'</div>'
      +'<a class="btn tiny outline" href="'+esc(link)+'" target="_blank" rel="noopener">🧭 Directions from anchor</a>'
    +'</div>';
  }).join('');
}
function renderSearch(){
  var redfinBase = 'https://www.redfin.com/city/30772/GA/Atlanta/filter/';
  var zState = {usersSearchTerm:'Atlanta, GA',filterState:{price:{max:700000},keywords:{value:'basement'}},isListVisible:true};
  var items = [
    {icon:'🟦',title:'Zillow — Atlanta, under $700k',
     desc:'Houses matching the "basement" keyword.',
     url:'https://www.zillow.com/homes/for_sale/?searchQueryState='+encodeURIComponent(JSON.stringify(zState))},
    {icon:'🟥',title:'Redfin — Atlanta, Basement, under $700k',
     desc:'Houses under $700k with "basement" in remarks.',
     url:redfinBase+'max-price=700k,property-type=house,remarks=basement'},
    {icon:'🏊',title:'Redfin — Pool homes, under $700k',
     desc:'Atlanta houses under $700k mentioning "pool".',
     url:redfinBase+'max-price=700k,property-type=house,remarks=pool'},
    {icon:'💧',title:'Redfin — Creek/water homes, under $700k',
     desc:'Atlanta houses under $700k mentioning "creek".',
     url:redfinBase+'max-price=700k,property-type=house,remarks=creek'}
  ];
  el('searchList').innerHTML = items.map(function(it){
    return '<div class="card search-card">'
      +'<div class="search-icon">'+it.icon+'</div>'
      +'<h3>'+esc(it.title)+'</h3>'
      +'<p>'+esc(it.desc)+'</p>'
      +'<a class="btn primary" href="'+esc(it.url)+'" target="_blank" rel="noopener">Open search ↗</a>'
    +'</div>';
  }).join('');
}

/* ============ Init ============ */
function init(){
  loadState();
  setVal('set_key',    state.apiKey);
  setVal('set_model',  state.model);
  setVal('set_anchor', state.anchor);
  el('sbAnchor').textContent = state.anchor;
  renderNeighborhoods();
  renderSearch();
  renderDiscover();
  renderHomes();
  updateCounts();

  // Sidebar nav
  var navBtns = document.querySelectorAll('.nav-item[data-sec]');
  for(var ni=0;ni<navBtns.length;ni++){
    (function(btn){ btn.addEventListener('click',function(){ showSection(btn.getAttribute('data-sec')); }); })(navBtns[ni]);
  }
  el('settingsBtn').addEventListener('click', openDrawer);

  // Drawer
  el('drawerOverlay').addEventListener('click', closeDrawer);
  el('drawerCloseBtn').addEventListener('click', closeDrawer);
  el('toggleKeyBtn').addEventListener('click', toggleKey);
  el('saveSettingsBtn').addEventListener('click', saveSettings);

  // Modal
  el('modalOverlay').addEventListener('click', function(e){ if(e.target===this) closeModal(); });
  el('modalCloseBtn').addEventListener('click', closeModal);
  el('modalCancelBtn').addEventListener('click', closeModal);
  el('modalSaveBtn').addEventListener('click', saveModal);

  // Sort
  el('sortSel').addEventListener('change', function(){ setSort(this.value); });

  // Add listing
  el('addAnalyzeBtn').addEventListener('click', submitAddListing);

  // Discover event delegation
  el('discoverList').addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]'); if(!btn) return;
    var action = btn.getAttribute('data-action');
    var id     = btn.getAttribute('data-id');
    if(action==='pass')   rateHome(id, 'disliked');
    else if(action==='like')  rateHome(id, 'liked');
    else if(action==='love')  rateHome(id, 'loved');
    else if(action==='retry') retryAnalysis(id);
    else if(action==='delete') deleteHome(id);
  });

  // Saved homes event delegation
  el('homesCards').addEventListener('click', function(e){
    var btn = e.target.closest('[data-action]'); if(!btn) return;
    var action = btn.getAttribute('data-action');
    var id     = btn.getAttribute('data-id');
    if(action==='analyze') analyzeHome(id);
    else if(action==='edit')   openModal(id);
    else if(action==='delete') deleteHome(id);
    else if(action==='queue'){
      var h=findHome(id);
      if(h){ h.status='pending'; saveHomes(); renderDiscover(); renderHomes(); updateCounts(); showSection('discover'); }
    }
  });

  // Escape key
  document.addEventListener('keydown', function(e){
    if(e.key==='Escape'){
      if(el('modalOverlay').classList.contains('show')) closeModal();
      else if(el('drawer').classList.contains('open'))  closeDrawer();
    }
  });
}

init();
