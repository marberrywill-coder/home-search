/* ============ Constants ============ */
var DEFAULT_ANCHOR   = '5163 Roswell Rd, Atlanta, GA 30342';
var DEFAULT_BUDGET   = 700000;
var DEFAULT_MUSTHAVE = 'basement, backyard';
var DEFAULT_PREFERRED= 'pool, creek, large lot';
var SEARCH_INTERVAL_DEFAULT = 60; // minutes

/* ============ State ============ */
var state = {
  /* persisted */
  apiKey: '', model: 'gemini-2.5-flash', anchor: DEFAULT_ANCHOR,
  budget: DEFAULT_BUDGET, mustHave: DEFAULT_MUSTHAVE, preferred: DEFAULT_PREFERRED,
  intervalMins: SEARCH_INTERVAL_DEFAULT,
  homes: [],     // all homes (pending / liked / loved / disliked)
  passed: [],    // [{address,url}] permanent do-not-show list
  lastSearchAt: null,
  sortBy: 'price_asc',
  /* transient */
  searchRunning: false, searchError: null,
  modalEditId: null
};

var searchTimer = null;

/* ============ Neighbourhood / search data ============ */
var NEIGHBORHOODS = [
  {name:'Sandy Springs',  zips:'30328, 30342, 30350', mins:'5-15 min',  note:'Surrounds the anchor — closest option.'},
  {name:'Dunwoody',       zips:'30338, 30346',         mins:'10-20 min', note:'Strong schools, Brook Run Park, MARTA access.'},
  {name:'Brookhaven',     zips:'30319',                mins:'10-20 min', note:'Walkable pockets, Murphey Candler Park, lively dining.'},
  {name:'Chamblee',       zips:'30341',                mins:'15-25 min', note:'Up-and-coming, good value, MARTA station.'},
  {name:'Roswell',        zips:'30075, 30076',          mins:'15-25 min', note:'Historic district and Chattahoochee River trails.'},
  {name:'Vinings',        zips:'30339',                mins:'15-25 min', note:'Upscale, riverside, easy I-285 access.'},
  {name:'Smyrna',         zips:'30080, 30082',          mins:'20-30 min', note:'Market Village, newer builds, solid value.'},
  {name:'East Cobb',      zips:'30062, 30068',          mins:'20-30 min', note:'Top-rated schools and larger, leafier lots.'},
  {name:'Marietta',       zips:'30060, 30064, 30067',   mins:'25-35 min', note:'Historic square — more land for the money.'}
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
function setVal(id,v){var e=el(id);if(e)e.value=(v==null?'':v);}
function timeSince(iso){
  var ms=Date.now()-new Date(iso).getTime(), m=Math.floor(ms/60000);
  if(m<1) return 'just now';
  if(m<60) return m+'m ago';
  var h=Math.floor(m/60); return h+'h'+(m%60?(' '+m%60+'m'):'') +' ago';
}
function normalizeKey(s){
  return String(s||'').toLowerCase()
    .replace(/^https?:\/\/(www\.)?/,'')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim().slice(0,100);
}

/* ============ Persistence ============ */
function loadState(){
  try{
    state.apiKey       = localStorage.getItem('hsa_apiKey')     ||'';
    state.model        = localStorage.getItem('hsa_model')      ||'gemini-2.5-flash';
    state.anchor       = localStorage.getItem('hsa_anchor')     ||DEFAULT_ANCHOR;
    state.budget       = parseInt(localStorage.getItem('hsa_budget')||DEFAULT_BUDGET,10)||DEFAULT_BUDGET;
    state.mustHave     = localStorage.getItem('hsa_mustHave')   ||DEFAULT_MUSTHAVE;
    state.preferred    = localStorage.getItem('hsa_preferred')  ||DEFAULT_PREFERRED;
    state.intervalMins = parseInt(localStorage.getItem('hsa_interval')||SEARCH_INTERVAL_DEFAULT,10);
    state.sortBy       = localStorage.getItem('hsa_sortBy')     ||'price_asc';
    state.lastSearchAt = localStorage.getItem('hsa_lastSearchAt')||null;

    var h=localStorage.getItem('hsa_homes');
    var homes=h?JSON.parse(h):[];
    // Migrate: old homes without status → liked (they were saved intentionally)
    homes.forEach(function(hm){if(!hm.status) hm.status='liked';});
    state.homes=homes;

    var p=localStorage.getItem('hsa_passed');
    state.passed=p?JSON.parse(p):[];
  }catch(e){state.homes=[];state.passed=[];}
}
function saveHomes(){
  var clean=state.homes.map(function(h){
    var o={};for(var k in h){if(h.hasOwnProperty(k)&&k.charAt(0)!=='_')o[k]=h[k];}return o;});
  localStorage.setItem('hsa_homes',JSON.stringify(clean));
}
function savePassed(){localStorage.setItem('hsa_passed',JSON.stringify(state.passed));}
function saveSettings(){
  localStorage.setItem('hsa_apiKey',    state.apiKey);
  localStorage.setItem('hsa_model',     state.model);
  localStorage.setItem('hsa_anchor',    state.anchor);
  localStorage.setItem('hsa_budget',    state.budget);
  localStorage.setItem('hsa_mustHave',  state.mustHave);
  localStorage.setItem('hsa_preferred', state.preferred);
  localStorage.setItem('hsa_interval',  state.intervalMins);
  localStorage.setItem('hsa_sortBy',    state.sortBy);
}

/* ============ Navigation ============ */
function showSection(name){
  var secs=document.querySelectorAll('.section');
  for(var i=0;i<secs.length;i++) secs[i].classList.toggle('active',secs[i].id==='sec-'+name);
  var navs=document.querySelectorAll('.nav-item[data-sec]');
  for(var j=0;j<navs.length;j++) navs[j].classList.toggle('active',navs[j].getAttribute('data-sec')===name);
}

/* ============ Settings drawer ============ */
function openDrawer(){
  setVal('set_key',     state.apiKey);
  setVal('set_model',   state.model);
  setVal('set_anchor',  state.anchor);
  setVal('set_budget',  state.budget);
  setVal('set_musthave',state.mustHave);
  setVal('set_preferred',state.preferred);
  setVal('set_interval',state.intervalMins);
  el('drawer').classList.add('open'); el('drawerOverlay').classList.add('show');
  el('setSaved').style.display='none';
}
function closeDrawer(){el('drawer').classList.remove('open');el('drawerOverlay').classList.remove('show');}
function toggleKey(){var i=el('set_key');i.type=i.type==='password'?'text':'password';}
function applySettings(){
  state.apiKey       = el('set_key').value.trim();
  state.model        = el('set_model').value.trim()||'gemini-2.5-flash';
  state.anchor       = el('set_anchor').value.trim()||DEFAULT_ANCHOR;
  state.budget       = parseInt(el('set_budget').value||DEFAULT_BUDGET,10)||DEFAULT_BUDGET;
  state.mustHave     = el('set_musthave').value.trim()||DEFAULT_MUSTHAVE;
  state.preferred    = el('set_preferred').value.trim()||DEFAULT_PREFERRED;
  state.intervalMins = parseInt(el('set_interval').value||60,10);
  saveSettings();
  el('setSaved').style.display='block';
  el('sbAnchor').textContent=state.anchor;
  renderNeighborhoods();
  scheduleAutoSearch(); // reschedule with new interval
}

/* ============ Gemini search-tool helpers ============ */
function makeSearchTools(){
  // gemini-2.0+ uses google_search; gemini-1.5 uses google_search_retrieval
  if(/gemini-1\.5/i.test(state.model||'')){
    return [{google_search_retrieval:{dynamic_retrieval_config:{mode:'MODE_DYNAMIC',dynamic_threshold:0.3}}}];
  }
  return [{google_search:{}}];
}

function buildDiscoveryPrompt(){
  var mustList = state.mustHave.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var prefList = state.preferred.split(',').map(function(s){return s.trim();}).filter(Boolean);
  var budget   = state.budget || DEFAULT_BUDGET;
  var anchor   = state.anchor || DEFAULT_ANCHOR;

  // Build skip list (addresses + URLs of everything we've already seen)
  var seen = getSeenKeys();
  var skipSection = seen.length
    ? '\n\nSKIP any property matching these already-seen addresses or URLs (do not include them in results):\n'
      + seen.slice(0,40).join('\n')
    : '';

  return 'Use Google Search to find houses currently for sale near '+anchor+' in the Atlanta, GA metro area.\n\n'
    +'BUYER CRITERIA — only return listings that meet ALL of these:\n'
    +'- Type: single-family house (not condo, townhouse, or land)\n'
    +'- Max price: $'+budget.toLocaleString('en-US')+'\n'
    +'- Must mention: '+mustList.join(', ')+'\n\n'
    +'PREFERRED FEATURES — prioritize listings that have any of these:\n'
    +'- '+prefList.join('\n- ')+'\n'
    +skipSection
    +'\n\nSearch Zillow, Redfin, and Realtor.com for currently active listings. '
    +'Find 4–6 real, distinct properties. For each one extract all available details '
    +'and run an X-factor analysis.\n\n'
    +'X-factors are standout, unusual, or especially desirable features — e.g. creek/stream on property, '
    +'pool, large wooded lot, covered outdoor living, workshop/studio, lake access, sunroom, '
    +'finished basement with extras, exceptional views, ADU, chef\'s kitchen, or similar.\n\n'
    +'Return ONLY this JSON (no prose, no markdown):\n'
    +'{\n'
    +'  "listings": [\n'
    +'    {\n'
    +'      "address": "123 Creek Dr, Sandy Springs, GA 30342",\n'
    +'      "price": 649000,\n'
    +'      "beds": 4,\n'
    +'      "baths": 3.0,\n'
    +'      "sqft": 3100,\n'
    +'      "url": "https://www.zillow.com/homedetails/...",\n'
    +'      "x_factors": [\n'
    +'        {"label":"Creek","emoji":"💧","reason":"Listing states property backs to a seasonal creek"}\n'
    +'      ],\n'
    +'      "criteria_scores": {\n'
    +'        "price": "Yes — $649k under $'+budget.toLocaleString('en-US')+' budget",\n'
    +'        "basement": "Yes — listing mentions full unfinished basement",\n'
    +'        "backyard": "Yes — described as half-acre flat lot"\n'
    +'      },\n'
    +'      "vibe_summary": "2-3 sentences on what makes this home special or why it falls flat"\n'
    +'    }\n'
    +'  ]\n'
    +'}\n\n'
    +'Use null for any numeric field you cannot find. '
    +'Return {"listings":[]} if no qualifying listings are found.';
}

function buildLookupPrompt(urlOrAddress){
  var isUrl = /^https?:\/\//i.test(urlOrAddress);
  var target = isUrl
    ? 'Look up the real estate listing at this specific URL: '+urlOrAddress
    : 'Look up the real estate listing for this property: '+urlOrAddress;

  var budget = state.budget || DEFAULT_BUDGET;
  return target+'\n\n'
    +'Use Google Search to find all available details about this property.\n\n'
    +'BUYER CRITERIA:\n'
    +'- Budget: under $'+budget.toLocaleString('en-US')+'\n'
    +'- Must-haves: '+state.mustHave+'\n'
    +'- Preferences: '+state.preferred+'\n\n'
    +'X-factors are standout or unusual features — creek, pool, large lot, sunroom, workshop, '
    +'lake access, exceptional views, ADU, covered porch, finished basement extras, etc.\n\n'
    +'Return ONLY this JSON (no prose, no markdown):\n'
    +'{\n'
    +'  "listings": [\n'
    +'    {\n'
    +'      "address": "full address",\n'
    +'      "price": 0,\n'
    +'      "beds": 0, "baths": 0, "sqft": 0,\n'
    +'      "url": "'+String(isUrl?urlOrAddress:'').replace(/"/g,'\\"')+'",\n'
    +'      "x_factors": [{"label":"Feature","emoji":"✨","reason":"evidence"}],\n'
    +'      "criteria_scores": {"price":"...","basement":"...","backyard":"..."},\n'
    +'      "vibe_summary": "2-3 sentences"\n'
    +'    }\n'
    +'  ]\n'
    +'}\n\n'
    +'Return exactly 1 listing. If you cannot find it, return {"listings":[]}.';
}

/* ============ Gemini API call (with Google Search tool) ============ */
function callSearchAI(prompt){
  if(!state.apiKey) return Promise.reject(new Error(
    'No API key — open ⚙️ Settings and add your free Gemini key from aistudio.google.com/apikey'));
  var model    = state.model||'gemini-2.5-flash';
  var endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/'
    +encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(state.apiKey);
  var body = {
    contents:[{parts:[{text:prompt}]}],
    tools: makeSearchTools()
    // Note: responseMimeType cannot be combined with tools — we parse JSON from text
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
    },function(e){throw new Error('Network error: '+e.message);})
    .then(function(data){
      var candidates=data.candidates||[];
      if(!candidates.length) throw new Error('No candidates returned. Check API key and model in Settings.');
      // Concatenate all text parts from the response
      var parts=(candidates[0].content||{}).parts||[];
      var text=parts.map(function(p){return p.text||'';}).join('').trim();
      if(!text) throw new Error('Gemini returned an empty response. Try again.');
      return text;
    });
}

/* ============ Parse listings from Gemini response ============ */
function extractJsonObject(text){
  // Strip markdown code fences first
  var t=text.replace(/```[a-z]*\n?/g,'').replace(/```/g,'').trim();
  // Find the outermost { ... }
  var start=t.indexOf('{');
  if(start===-1) throw new Error('No JSON object in response');
  var depth=0,inStr=false,esc2=false;
  for(var i=start;i<t.length;i++){
    var c=t[i];
    if(inStr){if(esc2)esc2=false;else if(c==='\\')esc2=true;else if(c==='"')inStr=false;}
    else{if(c==='"')inStr=true;else if(c==='{')depth++;else if(c==='}'){depth--;if(depth===0)return t.slice(start,i+1);}}
  }
  throw new Error('Incomplete JSON in response');
}

function parseListings(text){
  try{
    var json=JSON.parse(extractJsonObject(text));
    var arr=Array.isArray(json.listings)?json.listings:(Array.isArray(json)?json:[]);
    return arr.filter(function(l){return l&&(l.address||l.url);}).map(function(l){
      return {
        address:  String(l.address||''),
        price:    typeof l.price==='number'?l.price:parsePrice(l.price),
        beds:     typeof l.beds==='number'?l.beds:parseNum(l.beds),
        baths:    typeof l.baths==='number'?l.baths:parseNum(l.baths),
        sqft:     typeof l.sqft==='number'?l.sqft:parseNum(l.sqft),
        url:      String(l.url||''),
        x_factors:Array.isArray(l.x_factors)?l.x_factors.map(function(f){
          return{label:String(f.label||'Feature'),emoji:String(f.emoji||'✨'),reason:String(f.reason||'')};
        }):[],
        criteria_scores:(l.criteria_scores&&typeof l.criteria_scores==='object')?l.criteria_scores:{},
        vibe_summary:String(l.vibe_summary||'')
      };
    });
  }catch(e){
    console.warn('parseListings error:',e.message,'\nRaw:',text.slice(0,300));
    return [];
  }
}

/* ============ Deduplication ============ */
function getSeenKeys(){
  var keys=[];
  state.homes.forEach(function(h){
    if(h.address) keys.push(h.address);
    if(h.url)     keys.push(h.url);
  });
  state.passed.forEach(function(p){
    if(p.address) keys.push(p.address);
    if(p.url)     keys.push(p.url);
  });
  return keys;
}
function isAlreadySeen(listing){
  var lUrl  = normalizeKey(listing.url);
  var lAddr = normalizeKey(listing.address);
  function matches(h){
    if(lUrl  && lUrl  === normalizeKey(h.url||''))     return true;
    if(lAddr && lAddr === normalizeKey(h.address||'')) return true;
    return false;
  }
  for(var i=0;i<state.homes.length;i++)  if(matches(state.homes[i]))  return true;
  for(var j=0;j<state.passed.length;j++) if(matches(state.passed[j])) return true;
  return false;
}

/* ============ Auto-discovery ============ */
function findListings(){
  if(state.searchRunning) return;
  if(!state.apiKey){
    state.searchError = 'Add your free Gemini API key in ⚙️ Settings to enable auto-discovery.';
    renderDiscoverStatus(); return;
  }
  state.searchRunning = true;
  state.searchError   = null;
  renderDiscoverStatus();

  callSearchAI(buildDiscoveryPrompt())
    .then(function(text){
      var listings = parseListings(text);
      var added = 0;
      listings.forEach(function(l){
        if(!isAlreadySeen(l)){
          var home = newHome(l);
          home.analysis = {
            x_factors:       l.x_factors,
            criteria_scores: l.criteria_scores,
            vibe_summary:    l.vibe_summary,
            analyzedAt:      new Date().toISOString()
          };
          state.homes.push(home);
          added++;
        }
      });
      state.lastSearchAt = new Date().toISOString();
      localStorage.setItem('hsa_lastSearchAt', state.lastSearchAt);
      saveHomes();
      if(!listings.length){
        state.searchError = 'No matching listings found this pass. Will try again at next interval.';
      } else if(!added){
        state.searchError = 'Found '+listings.length+' listing(s) but all are already in your queue.';
      } else {
        state.searchError = null;
      }
    })
    .catch(function(e){ state.searchError = e.message; })
    .then(function(){
      state.searchRunning = false;
      renderDiscoverStatus();
      renderDiscover();
      updateCounts();
      scheduleAutoSearch();
    });
}

function scheduleAutoSearch(){
  if(searchTimer) clearTimeout(searchTimer);
  if(!state.intervalMins || state.intervalMins <= 0) return; // manual-only mode
  var intervalMs = state.intervalMins * 60 * 1000;
  var lastMs     = state.lastSearchAt ? new Date(state.lastSearchAt).getTime() : 0;
  var elapsed    = Date.now() - lastMs;
  var delay      = Math.max(5000, intervalMs - elapsed); // at least 5s
  searchTimer = setTimeout(function(){ findListings(); }, delay);
}

/* ============ Home objects ============ */
function newHome(i){
  return {
    id:       'h'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36),
    address:  i.address||'', price: i.price||null,
    url:      i.url||'',
    beds:     i.beds!=null?i.beds:null, baths: i.baths!=null?i.baths:null, sqft: i.sqft||null,
    notes:    i.notes||'',
    status:   'pending',
    analysis: null, createdAt: new Date().toISOString()
  };
}
function xCount(h){return(h.analysis&&h.analysis.x_factors)?h.analysis.x_factors.length:0;}
function findHome(id){for(var i=0;i<state.homes.length;i++)if(state.homes[i].id===id)return state.homes[i];return null;}
function deleteHome(id){
  var h=findHome(id);if(!h)return;
  if(!confirm('Remove "'+(h.address||'this listing')+'"?'))return;
  state.homes=state.homes.filter(function(x){return x.id!==id;});
  saveHomes();updateCounts();renderDiscover();renderHomes();
}

/* ============ Rating ============ */
function rateHome(id, status){
  var home=findHome(id);if(!home)return;
  if(status==='disliked'){
    // Permanently mark as passed so auto-search never resurfaces it
    state.passed.push({address:home.address,url:home.url});
    savePassed();
  }
  home.status=status;
  saveHomes();renderDiscover();renderHomes();updateCounts();
}

/* ============ Add Manually (URL lookup) ============ */
function submitAddManually(){
  var url = el('add_url').value.trim();
  var btn = el('addAnalyzeBtn');
  if(!url){ showAddError('Please paste a listing URL first.'); return; }
  if(!/^https?:\/\//i.test(url)){ showAddError('Enter a full URL starting with https://'); return; }
  if(!state.apiKey){ showAddError('Add your Gemini API key in ⚙️ Settings first.'); return; }
  showAddError('');
  btn.disabled=true; btn.textContent='Looking up…';

  callSearchAI(buildLookupPrompt(url))
    .then(function(text){
      var listings=parseListings(text);
      if(!listings.length) throw new Error('Could not find listing details. Check the URL is active and try again.');
      var l=listings[0];
      if(isAlreadySeen(l)) throw new Error('This listing is already in your queue or has been passed.');
      var home=newHome({url:url||l.url,address:l.address,price:l.price,beds:l.beds,baths:l.baths,sqft:l.sqft});
      home.analysis={x_factors:l.x_factors,criteria_scores:l.criteria_scores,vibe_summary:l.vibe_summary,analyzedAt:new Date().toISOString()};
      state.homes.push(home);
      saveHomes();
      el('add_url').value='';
      showSection('discover');
      renderDiscover();updateCounts();
    })
    .catch(function(e){showAddError(e.message);})
    .then(function(){btn.disabled=false;btn.textContent='🔍 Look Up & Analyze';});
}
function showAddError(msg){var e=el('addError');if(msg){e.textContent=msg;e.style.display='';}else{e.style.display='none';}}

/* ============ Re-analyze ============ */
function analyzeHome(id){
  var home=findHome(id);if(!home)return;
  var target=home.url||home.address;
  if(!target){alert('No URL or address saved for this home.');return;}
  home._analyzing=true;renderHomes();
  callSearchAI(buildLookupPrompt(target))
    .then(function(text){
      var listings=parseListings(text);
      if(listings.length){
        var l=listings[0];
        home.analysis={x_factors:l.x_factors,criteria_scores:l.criteria_scores,vibe_summary:l.vibe_summary,analyzedAt:new Date().toISOString()};
        if(l.address&&!home.address) home.address=l.address;
        if(l.price&&!home.price)     home.price=l.price;
        if(l.beds!=null&&!home.beds)   home.beds=l.beds;
        if(l.baths!=null&&!home.baths) home.baths=l.baths;
        if(l.sqft&&!home.sqft)       home.sqft=l.sqft;
      }
    })
    .catch(function(e){alert('Re-analysis failed:\n\n'+e.message);})
    .then(function(){home._analyzing=false;saveHomes();renderHomes();});
}

function retryAnalysis(id){
  var home=findHome(id);if(!home)return;
  delete home._error;
  home._analyzing=true;
  renderDiscover();
  var target=home.url||home.address||'';
  callSearchAI(buildLookupPrompt(target))
    .then(function(text){
      var listings=parseListings(text);
      if(listings.length){
        var l=listings[0];
        home.analysis={x_factors:l.x_factors,criteria_scores:l.criteria_scores,vibe_summary:l.vibe_summary,analyzedAt:new Date().toISOString()};
        if(l.address) home.address=l.address;
        if(l.price)   home.price=l.price;
        if(l.beds!=null)  home.beds=l.beds;
        if(l.baths!=null) home.baths=l.baths;
        if(l.sqft)    home.sqft=l.sqft;
        delete home._error;
      } else {
        home._error='No listing info found. The listing may be sold or unavailable.';
      }
    })
    .catch(function(e){home._error=e.message;})
    .then(function(){home._analyzing=false;saveHomes();renderDiscover();updateCounts();});
}

/* ============ Counts ============ */
function updateCounts(){
  var pending=state.homes.filter(function(h){return!h.status||h.status==='pending';});
  var saved  =state.homes.filter(function(h){return h.status==='liked'||h.status==='loved';});
  el('discoverCount').textContent=pending.length||'';
  el('homesCount').textContent   =saved.length  ||'';
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
  if(!a)return'';
  var h='';
  if(a.vibe_summary) h+='<div class="vibe">'+esc(a.vibe_summary)+'</div>';
  var n=(a.x_factors&&a.x_factors.length)?a.x_factors.length:0;
  h+='<span class="block-label">✨ X-Factors'+(n?' ('+n+')':'')+'</span>';
  if(n){h+='<div class="xfactors">'+a.x_factors.map(xfactorRowHtml).join('')+'</div>';}
  else{h+='<div class="muted-note">No standout X-factors detected.</div>';}
  var cs=a.criteria_scores||{},keys=Object.keys(cs);
  if(keys.length){
    h+='<span class="block-label">📋 Baseline Criteria</span><div class="criteria">';
    h+=keys.map(function(k){
      return'<div class="crit"><div class="crit-k">'+esc(prettyKey(k))+'</div>'
        +'<div class="crit-v">'+esc(String(cs[k]))+'</div></div>';
    }).join('');
    h+='</div>';
  }
  return h;
}
function criteriaChipsHtml(cs){
  if(!cs||!Object.keys(cs).length)return'';
  var chips=Object.keys(cs).map(function(k){
    var val=String(cs[k]||''),lower=val.toLowerCase(),cls='chip-neutral';
    if(/\byes\b/.test(lower)||/under budget|within budget|meets/.test(lower)) cls='chip-good';
    else if(/\bno\b/.test(lower)||/unknown|not found|not mentioned|over budget/.test(lower)) cls='chip-bad';
    return'<span class="crit-chip '+cls+'">'+esc(prettyKey(k))+': '+esc(val.slice(0,60))+'</span>';
  });
  return'<div class="disc-criteria">'+chips.join('')+'</div>';
}

/* ============ Rendering: Discover status bar ============ */
function renderDiscoverStatus(){
  var bar=el('discoverStatus');if(!bar)return;
  if(!state.apiKey){
    bar.innerHTML='<div class="no-key-note">⚙️ Add your free Gemini API key in <b>Settings</b> (bottom-left) to enable auto-discovery of listings.</div>';
    return;
  }
  var inner='';
  if(state.searchRunning){
    inner='<span class="status-searching">'
      +'<span class="loading-dots"><span></span><span></span><span></span></span>'
      +'Searching for new listings near '+esc(state.anchor)+'…</span>';
  }else{
    var timeStr=state.lastSearchAt?'Last searched: '+timeSince(state.lastSearchAt):'Never searched';
    inner='<span class="status-time">🔄 '+esc(timeStr)+'</span>';
    if(state.searchError){
      inner+='<span class="status-err" title="'+esc(state.searchError)+'">⚠️ '+esc(state.searchError.slice(0,80))+'</span>';
    }
  }
  inner+='<button class="btn tiny outline" id="findNowBtn"'+(state.searchRunning?' disabled':'')+'>🔍 Find Now</button>';
  bar.innerHTML='<div class="discover-status">'+inner+'</div>';
  // status bar uses event delegation wired in init()
}

/* ============ Rendering: Discover queue ============ */
function renderDiscover(){
  var pending=state.homes.filter(function(h){return!h.status||h.status==='pending';});
  renderDiscoverStatus();
  var list=el('discoverList');
  if(!pending.length){
    list.innerHTML='<div class="empty">Your queue is empty.<br/><br/>'
      +'The AI will auto-search for listings matching your criteria '+(state.intervalMins>0?'every '+state.intervalMins+' minutes':'when you click "Find Now"')+'.<br/><br/>'
      +'You can also click <b>🔍 Find Now</b> above to search immediately, '
      +'or use <b>＋ Add Manually</b> to add a specific listing by URL.</div>';
    return;
  }
  list.innerHTML=pending.map(discoverCardHtml).join('');
}

function discoverCardHtml(h){
  if(h._analyzing){
    return'<div class="card disc-card disc-loading" data-id="'+h.id+'">'
      +'<div class="disc-loading-inner">'
      +'<div class="loading-dots"><span></span><span></span><span></span></div>'
      +'<div class="loading-msg">Analyzing…</div>'
      +(h.url?'<div class="loading-sub"><a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">'
        +esc(h.url.replace(/^https?:\/\/(www\.)?/,'').slice(0,70))+'</a></div>':'')
      +'</div></div>';
  }
  if(h._error){
    return'<div class="card disc-card" data-id="'+h.id+'">'
      +'<div class="error">⚠️ '+esc(h._error)+'</div>'
      +'<div style="display:flex;gap:8px;margin-top:12px">'
      +'<button class="btn tiny primary" data-action="retry"  data-id="'+h.id+'">↻ Retry</button>'
      +'<button class="btn tiny danger"  data-action="delete" data-id="'+h.id+'">Remove</button>'
      +'</div></div>';
  }
  var a=h.analysis||{},xf=a.x_factors||[],cs=a.criteria_scores||{};
  var specsHtml='';
  if(h.beds!=null||h.baths!=null||h.sqft){
    specsHtml='<div class="disc-specs">'
      +(h.beds !=null?'<span class="spec-chip">🛏 '+h.beds+' bd</span>':'')
      +(h.baths!=null?'<span class="spec-chip">🛁 '+h.baths+' ba</span>':'')
      +(h.sqft       ?'<span class="spec-chip">📐 '+Number(h.sqft).toLocaleString()+' sqft</span>':'')
      +'</div>';
  }
  return'<div class="card disc-card" data-id="'+h.id+'">'
    +'<div class="disc-head">'
      +'<div class="disc-addr">'+(h.address?esc(h.address):'<em style="color:var(--muted);font-style:normal">Address pending…</em>')+'</div>'
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
  var hs=state.homes.filter(function(h){return h.status==='liked'||h.status==='loved';});
  var by=state.sortBy;
  hs.sort(function(a,b){
    if(by==='xfactors')   return xCount(b)-xCount(a);
    if(by==='price_desc') return(b.price||-1)-(a.price||-1);
    return(a.price==null?Infinity:a.price)-(b.price==null?Infinity:b.price);
  });
  return hs;
}
function homeCardHtml(h){
  var a=h.analysis;
  var badge=h.status==='loved'?'<span class="status-love">❤️ Love it</span>':'<span class="status-like">👍 Like</span>';
  var specsHtml='';
  if(h.beds!=null||h.baths!=null||h.sqft){
    specsHtml='<div class="disc-specs" style="margin:6px 0 0">'
      +(h.beds !=null?'<span class="spec-chip">🛏 '+h.beds+' bd</span>':'')
      +(h.baths!=null?'<span class="spec-chip">🛁 '+h.baths+' ba</span>':'')
      +(h.sqft       ?'<span class="spec-chip">📐 '+Number(h.sqft).toLocaleString()+' sqft</span>':'')
      +'</div>';
  }
  return'<div class="card home-card">'
    +'<div class="home-top"><div style="flex:1;min-width:0">'
      +'<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:5px">'
        +badge+(h.url?'<a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">View listing ↗</a>':'')
      +'</div>'
      +'<div class="home-addr">'+esc(h.address||'(no address)')+'</div>'
      +specsHtml
    +'</div>'+(h.price?'<div class="price-tag">'+fmtPrice(h.price)+'</div>':'')+'</div>'
    +(a?analysisHtml(a):'<div class="muted-note">Not analyzed yet.</div>')
    +(h.notes?'<div class="home-notes">📝 '+esc(h.notes)+'</div>':'')
    +'<div class="card-actions">'
      +'<button class="btn tiny outline" data-action="queue"   data-id="'+h.id+'">↩ Back to Queue</button>'
      +'<button class="btn tiny primary"'+(h._analyzing?' disabled':'')+' data-action="analyze" data-id="'+h.id+'">'
        +(h._analyzing?'Analyzing…':(a?'↻ Re-analyze':'✨ Analyze'))+'</button>'
      +'<button class="btn tiny outline" data-action="edit"   data-id="'+h.id+'">Edit</button>'
      +'<button class="btn tiny danger"  data-action="delete" data-id="'+h.id+'">Delete</button>'
    +'</div></div>';
}
function renderHomes(){
  var homes=sortedSaved();
  el('homesCount').textContent=homes.length||'';
  if(!homes.length){
    el('homesCards').innerHTML='<div class="empty">No saved homes yet.<br/><br/>'
      +'Rate listings as <b>👍 Like</b> or <b>❤️ Love it</b> in the Discover queue to save them here.</div>';
    return;
  }
  el('homesCards').innerHTML=homes.map(homeCardHtml).join('');
}
function setSort(v){state.sortBy=v;localStorage.setItem('hsa_sortBy',v);renderHomes();}

/* ============ Edit modal ============ */
function openModal(id){
  state.modalEditId=id||null;
  var h=id?findHome(id):null;
  setVal('md_address',h?h.address:'');
  setVal('md_price',  h?(h.price||''):'');
  setVal('md_url',    h?h.url:'');
  setVal('md_beds',   h&&h.beds !=null?h.beds: '');
  setVal('md_baths',  h&&h.baths!=null?h.baths:'');
  setVal('md_sqft',   h?(h.sqft||''):'');
  setVal('md_notes',  h?h.notes:'');
  el('modalOverlay').classList.add('show');
}
function closeModal(){el('modalOverlay').classList.remove('show');state.modalEditId=null;}
function saveModal(){
  if(!state.modalEditId)return;
  var home=findHome(state.modalEditId);if(!home)return;
  home.address=el('md_address').value.trim();
  home.price  =parsePrice(el('md_price').value)||home.price;
  home.url    =el('md_url').value.trim();
  home.beds   =parseNum(el('md_beds').value);
  home.baths  =parseNum(el('md_baths').value);
  home.sqft   =parseNum(el('md_sqft').value);
  home.notes  =el('md_notes').value.trim();
  saveHomes();renderHomes();closeModal();
}

/* ============ Neighborhoods & Search ============ */
function renderNeighborhoods(){
  el('nbAnchor').textContent=state.anchor;
  el('nbList').innerHTML=NEIGHBORHOODS.map(function(n){
    var link='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(state.anchor)
      +'&destination='+encodeURIComponent(n.name+', GA');
    return'<div class="card nb-card">'
      +'<div class="nb-top"><h3>'+esc(n.name)+'</h3><span class="nb-mins">'+esc(n.mins)+'</span></div>'
      +'<div class="nb-zips">ZIP: '+esc(n.zips)+'</div>'
      +'<div class="nb-note">'+esc(n.note)+'</div>'
      +'<a class="btn tiny outline" href="'+esc(link)+'" target="_blank" rel="noopener">🧭 Directions from anchor</a>'
    +'</div>';
  }).join('');
}
function renderSearch(){
  var base='https://www.redfin.com/city/30772/GA/Atlanta/filter/';
  var zState={usersSearchTerm:'Atlanta, GA',filterState:{price:{max:state.budget||700000},keywords:{value:'basement'}},isListVisible:true};
  var items=[
    {icon:'🟦',title:'Zillow — Atlanta, basement, under $'+((state.budget||700000)/1000).toFixed(0)+'k',
     desc:'Houses matching the "basement" keyword.',
     url:'https://www.zillow.com/homes/for_sale/?searchQueryState='+encodeURIComponent(JSON.stringify(zState))},
    {icon:'🟥',title:'Redfin — Basement, under $700k',
     desc:'Atlanta houses with "basement" in remarks.',url:base+'max-price=700k,property-type=house,remarks=basement'},
    {icon:'🏊',title:'Redfin — Pool, under $700k',
     desc:'Atlanta houses mentioning "pool".',url:base+'max-price=700k,property-type=house,remarks=pool'},
    {icon:'💧',title:'Redfin — Creek/water, under $700k',
     desc:'Atlanta houses mentioning "creek".',url:base+'max-price=700k,property-type=house,remarks=creek'}
  ];
  el('searchList').innerHTML=items.map(function(it){
    return'<div class="card search-card"><div class="search-icon">'+it.icon+'</div>'
      +'<h3>'+esc(it.title)+'</h3><p>'+esc(it.desc)+'</p>'
      +'<a class="btn primary" href="'+esc(it.url)+'" target="_blank" rel="noopener">Open search ↗</a>'
    +'</div>';
  }).join('');
}

/* ============ Init ============ */
function init(){
  loadState();
  setVal('set_key',      state.apiKey);
  setVal('set_model',    state.model);
  setVal('set_anchor',   state.anchor);
  setVal('set_budget',   state.budget);
  setVal('set_musthave', state.mustHave);
  setVal('set_preferred',state.preferred);
  setVal('set_interval', state.intervalMins);
  el('sbAnchor').textContent=state.anchor;
  renderNeighborhoods();
  renderSearch();
  renderDiscover();
  renderHomes();
  updateCounts();

  // Nav
  var navBtns=document.querySelectorAll('.nav-item[data-sec]');
  for(var ni=0;ni<navBtns.length;ni++){
    (function(btn){btn.addEventListener('click',function(){showSection(btn.getAttribute('data-sec'));});})(navBtns[ni]);
  }
  el('settingsBtn').addEventListener('click',openDrawer);
  el('drawerOverlay').addEventListener('click',closeDrawer);
  el('drawerCloseBtn').addEventListener('click',closeDrawer);
  el('toggleKeyBtn').addEventListener('click',toggleKey);
  el('saveSettingsBtn').addEventListener('click',applySettings);

  // Modal
  el('modalOverlay').addEventListener('click',function(e){if(e.target===this)closeModal();});
  el('modalCloseBtn').addEventListener('click',closeModal);
  el('modalCancelBtn').addEventListener('click',closeModal);
  el('modalSaveBtn').addEventListener('click',saveModal);

  // Sort
  el('sortSel').addEventListener('change',function(){setSort(this.value);});

  // Add manually
  el('addAnalyzeBtn').addEventListener('click',submitAddManually);

  // Discover status bar (event delegation — survives innerHTML replacement)
  el('discoverStatus').addEventListener('click',function(e){
    if(e.target.id==='findNowBtn') findListings();
  });

  // Discover queue (event delegation)
  el('discoverList').addEventListener('click',function(e){
    var btn=e.target.closest('[data-action]');if(!btn)return;
    var action=btn.getAttribute('data-action'),id=btn.getAttribute('data-id');
    if(action==='pass')        rateHome(id,'disliked');
    else if(action==='like')   rateHome(id,'liked');
    else if(action==='love')   rateHome(id,'loved');
    else if(action==='retry')  retryAnalysis(id);
    else if(action==='delete') deleteHome(id);
  });

  // Saved homes (event delegation)
  el('homesCards').addEventListener('click',function(e){
    var btn=e.target.closest('[data-action]');if(!btn)return;
    var action=btn.getAttribute('data-action'),id=btn.getAttribute('data-id');
    if(action==='analyze')     analyzeHome(id);
    else if(action==='edit')   openModal(id);
    else if(action==='delete') deleteHome(id);
    else if(action==='queue'){
      var h=findHome(id);
      if(h){h.status='pending';saveHomes();renderDiscover();renderHomes();updateCounts();showSection('discover');}
    }
  });

  // Escape key
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      if(el('modalOverlay').classList.contains('show'))closeModal();
      else if(el('drawer').classList.contains('open'))closeDrawer();
    }
  });

  // Update status bar "X min ago" text every minute
  setInterval(function(){if(!state.searchRunning)renderDiscoverStatus();},60000);

  // Auto-search on load if API key set
  if(state.apiKey){
    var pendingCount=state.homes.filter(function(h){return!h.status||h.status==='pending';}).length;
    var lastMs=state.lastSearchAt?new Date(state.lastSearchAt).getTime():0;
    var intervalMs=(state.intervalMins||60)*60*1000;
    var stale=Date.now()-lastMs>intervalMs;
    if(pendingCount===0||stale){
      setTimeout(findListings,2000); // brief delay so page renders first
    }else{
      scheduleAutoSearch(); // schedule next one from now
    }
  }
}

init();
