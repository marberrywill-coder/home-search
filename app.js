/* ============ State ============ */
var DEFAULT_ANCHOR = '5163 Roswell Rd, Atlanta, GA 30342';
var state = {
  apiKey:'', model:'gemini-2.5-flash', anchor:DEFAULT_ANCHOR,
  homes:[], sortBy:'price_asc', viewMode:'cards',
  modalEditId:null, lastAnalysis:null
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
function prettyKey(k){return String(k).replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();});}
function el(id){return document.getElementById(id);}
function setVal(id,v){el(id).value=v==null?'':v;}

/* ============ Persistence ============ */
function loadState(){
  try{
    state.apiKey = localStorage.getItem('hsa_apiKey')||'';
    state.model  = localStorage.getItem('hsa_model')||'gemini-2.5-flash';
    state.anchor = localStorage.getItem('hsa_anchor')||DEFAULT_ANCHOR;
    var h = localStorage.getItem('hsa_homes');
    state.homes = h?JSON.parse(h):[];
  }catch(e){state.homes=[];}
}
function saveHomes(){
  var clean = state.homes.map(function(h){
    var o={};for(var k in h){if(h.hasOwnProperty(k)&&k.charAt(0)!=='_')o[k]=h[k];}return o;});
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
function closeDrawer(){el('drawer').classList.remove('open');el('drawerOverlay').classList.remove('show');}
function toggleKey(){var i=el('set_key');i.type = i.type==='password'?'text':'password';}
function saveSettings(){
  state.apiKey = el('set_key').value.trim();
  state.model  = el('set_model').value.trim()||'gemini-2.5-flash';
  state.anchor = el('set_anchor').value.trim()||DEFAULT_ANCHOR;
  localStorage.setItem('hsa_apiKey',state.apiKey);
  localStorage.setItem('hsa_model',state.model);
  localStorage.setItem('hsa_anchor',state.anchor);
  el('setSaved').style.display='block';
  el('sbAnchor').textContent=state.anchor;
  renderNeighborhoods();
}

/* ============ Field reading ============ */
function readFields(p){
  return {
    url: el(p+'_url').value.trim(),
    address: el(p+'_address').value.trim(),
    price: parsePrice(el(p+'_price').value),
    notes: el(p+'_notes').value.trim(),
    desc: el(p+'_desc').value.trim(),
    images: el(p+'_images').value.split(/[\s,]+/).map(function(s){return s.trim();})
              .filter(function(s){return /^https?:\/\//i.test(s);})
  };
}

/* ============ Gemini API ============ */
function buildPrompt(i, loadedImgCount){
  var imgNote = (loadedImgCount > 0)
    ? loadedImgCount+' listing photo(s) are included with this message.\n\n'
    : ((i.images&&i.images.length) ? i.images.length+' image URL(s) were provided but could not be loaded (likely CORS restriction). Analyze based on description only.\n\n' : 'No photos were provided.\n\n');
  return 'You are an expert real estate scout helping a buyer evaluate a home for sale near Atlanta, GA.\n\n'
+'THE BUYER\'S CRITERIA\n'
+'- Budget: under $700,000\n'
+'- Must-haves: a basement (finished or unfinished); a decent, usable backyard\n'
+'- Strong preferences: a pool; a creek or stream on the property\n\n'
+'YOUR JOB\n'
+'Analyze the listing using the description text and any photos provided. Identify "X-factors" -- standout, unusual, or '
+'delightful features that make a home special. Examples: large or unique backyard, creek/stream/pond/water on the property, '
+'pool, sunroom, workshop, lake access, treehouse, covered outdoor living space, exceptional views, unique or notable '
+'architecture, unusually large lot, detached garage/studio/ADU, chef\'s kitchen, finished basement with extras, and similar.\n\n'
+'For every X-factor give a ONE-LINE reason citing evidence -- quote the description or reference a photo (e.g. "Photo 4 shows...").\n'
+'Also score the baseline criteria (price vs budget, basement, backyard).\n\n'
+'LISTING URL (reference only -- you cannot open it): '+(i.url||'(none provided)')+'\n'
+'STATED PRICE: '+(i.price?'$'+Number(i.price).toLocaleString('en-US'):'(not provided)')+'\n'
+'ADDRESS: '+(i.address||'(not provided)')+'\n\n'
+'LISTING DESCRIPTION:\n"""\n'+(i.desc||'(no description provided)')+'\n"""\n\n'
+imgNote
+'Return ONLY a valid JSON object with exactly this shape (no markdown, no prose):\n'
+'{\n'
+'  "x_factors": [\n'
+'    { "label": "Creek", "emoji": "streamemoji", "reason": "Description mentions a running creek along the rear property line" }\n'
+'  ],\n'
+'  "criteria_scores": {\n'
+'    "price": "assessment vs the $700k budget, or Unknown if not given",\n'
+'    "basement": "Yes / No / Unknown plus brief evidence",\n'
+'    "backyard": "size and quality estimate with brief evidence"\n'
+'  },\n'
+'  "vibe_summary": "2-3 sentences on what makes this house special -- or why it falls flat"\n'
+'}\n\n'
+'If little information is available, return the JSON with an empty x_factors array and Unknown scores.';
}

function extractJsonObject(text){
  var t=text.trim();
  var start=t.indexOf('{');
  if(start===-1) throw new Error('No JSON object found in response');
  var depth=0,inStr=false,esc2=false;
  for(var i=start;i<t.length;i++){
    var c=t[i];
    if(inStr){
      if(esc2)esc2=false;
      else if(c==='\\')esc2=true;
      else if(c==='"')inStr=false;
    }else{
      if(c==='"')inStr=true;
      else if(c==='{')depth++;
      else if(c==='}'){depth--;if(depth===0)return t.slice(start,i+1);}
    }
  }
  throw new Error('Incomplete JSON in response');
}

function parseAnalysis(text){
  var raw;
  try{ raw=JSON.parse(extractJsonObject(text)); }
  catch(e){ throw new Error('Could not parse the AI response as JSON.\n\nRaw response:\n'+text.slice(0,300)); }
  var xf=Array.isArray(raw.x_factors)?raw.x_factors.map(function(f){
    return {label:String(f.label||'Feature'),emoji:String(f.emoji||'✨'),reason:String(f.reason||'')};
  }):[];
  return {
    x_factors:xf,
    criteria_scores:(raw.criteria_scores&&typeof raw.criteria_scores==='object')?raw.criteria_scores:{},
    vibe_summary:String(raw.vibe_summary||''),
    analyzedAt:new Date().toISOString()
  };
}

function fetchImageBase64(url){
  return fetch(url,{mode:'cors'}).then(function(r){
    if(!r.ok) return null;
    var mime=(r.headers.get('content-type')||'image/jpeg').split(';')[0].trim();
    return r.blob().then(function(blob){
      return new Promise(function(resolve){
        var reader=new FileReader();
        reader.onload=function(){ resolve({mimeType:mime,data:reader.result.split(',')[1]}); };
        reader.onerror=function(){ resolve(null); };
        reader.readAsDataURL(blob);
      });
    });
  }).catch(function(){ return null; });
}

function callAI(i){
  if(!state.apiKey) return Promise.reject(new Error('No API key set. Open Settings (bottom-left) and add your free Gemini API key from aistudio.google.com/apikey'));
  var imageUrls=(i.images||[]).slice(0,10);
  var model=state.model||'gemini-2.5-flash';
  var endpoint='https://generativelanguage.googleapis.com/v1beta/models/'
    +encodeURIComponent(model)+':generateContent?key='+encodeURIComponent(state.apiKey);
  var imgPromises=imageUrls.map(fetchImageBase64);
  return Promise.all(imgPromises).then(function(results){
    var loaded=results.filter(function(r){return r!==null;});
    var parts=[];
    for(var k=0;k<loaded.length;k++){
      parts.push({inlineData:{mimeType:loaded[k].mimeType,data:loaded[k].data}});
    }
    parts.push({text:buildPrompt(i,loaded.length)});
    var body={
      contents:[{parts:parts}],
      generationConfig:{responseMimeType:'application/json',maxOutputTokens:1800}
    };
    return fetch(endpoint,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify(body)
    }).then(function(res){
      if(!res.ok){
        return res.text().then(function(txt){
          var msg=txt;
          try{var j=JSON.parse(txt);if(j.error&&j.error.message)msg=j.error.message;}catch(e){}
          throw new Error('Gemini API '+res.status+': '+msg);
        });
      }
      return res.json();
    },function(netErr){
      throw new Error('Network error reaching Gemini API: '+netErr.message);
    }).then(function(data){
      var candidates=data.candidates||[];
      if(!candidates.length) throw new Error('Gemini returned no candidates. Check your API key and model name in Settings.');
      var pts=(candidates[0].content||{}).parts||[];
      var text=pts.map(function(p){return p.text||'';}).join('').trim();
      if(!text) throw new Error('Gemini returned an empty response.');
      return parseAnalysis(text);
    });
  });
}

/* ============ Analyzer ============ */
function runAnalyzer(){
  var inputs=readFields('an');
  var btn=el('anAnalyzeBtn');
  showAnalyzerError('');
  btn.disabled=true; btn.textContent='Analyzing…';
  callAI(inputs).then(function(analysis){
    state.lastAnalysis=analysis;
    el('anResult').innerHTML='<div class="card result-card"><h2>Analysis Result</h2>'
      +analysisHtml(analysis)
      +'<div class="analyzed-at">Analyzed '+new Date(analysis.analyzedAt).toLocaleString()+'</div></div>';
    el('anSaveBtn').style.display='';
  }).catch(function(e){
    showAnalyzerError(e.message);
  }).then(function(){
    btn.disabled=false; btn.textContent='✨ Analyze with AI';
  });
}
function showAnalyzerError(msg){
  var e=el('anError');
  if(msg){e.textContent=msg;e.style.display='';}else{e.style.display='none';}
}
function saveAnalyzerToTracker(){
  var i=readFields('an');
  var home=newHome(i);
  home.analysis=state.lastAnalysis||null;
  state.homes.push(home);
  saveHomes(); renderHomes();
  el('anSaveBtn').style.display='none';
  showSection('homes');
}

/* ============ Home objects ============ */
function newHome(i){
  return {
    id:'h'+Date.now().toString(36)+Math.floor(Math.random()*1e4).toString(36),
    address:i.address||'', price:i.price||null, url:i.url||'', notes:i.notes||'',
    desc:i.desc||'', images:i.images||[], analysis:null, createdAt:new Date().toISOString()
  };
}
function xCount(h){return (h.analysis&&h.analysis.x_factors)?h.analysis.x_factors.length:0;}

/* ============ Modal ============ */
function openModal(id){
  state.modalEditId=id||null;
  var h=id?findHome(id):null;
  el('modalTitle').textContent=h?'Edit Home':'Add a Home';
  setVal('md_url',h?h.url:''); setVal('md_address',h?h.address:'');
  setVal('md_price',h?(h.price||''):''); setVal('md_notes',h?h.notes:'');
  setVal('md_desc',h?h.desc:''); setVal('md_images',h?(h.images||[]).join('\n'):'');
  el('modalOverlay').classList.add('show');
}
function closeModal(){el('modalOverlay').classList.remove('show');state.modalEditId=null;}
function findHome(id){
  for(var i=0;i<state.homes.length;i++) if(state.homes[i].id===id) return state.homes[i];
  return null;
}
function saveModal(analyzeAfter){
  var i=readFields('md');
  if(!i.address && !i.url){ alert('Add at least an address or a listing URL.'); return; }
  var home;
  if(state.modalEditId){
    home=findHome(state.modalEditId);
    home.address=i.address;home.price=i.price;home.url=i.url;
    home.notes=i.notes;home.desc=i.desc;home.images=i.images;
  }else{
    home=newHome(i); state.homes.push(home);
  }
  saveHomes(); renderHomes(); closeModal();
  if(analyzeAfter) analyzeHome(home.id);
}

/* ============ Home analysis ============ */
function analyzeHome(id){
  var home=findHome(id);
  if(!home) return;
  if(!home.desc && (!home.images||!home.images.length)){
    if(!confirm('This home has no description or image URLs saved, so the analysis will be very limited.\n\nUse "Edit" to add a description and photo URLs first.\n\nRun anyway?')) return;
  }
  home._analyzing=true; renderHomes();
  callAI({url:home.url,address:home.address,price:home.price,desc:home.desc,images:home.images})
    .then(function(analysis){ home.analysis=analysis; })
    .catch(function(e){ alert('Analysis failed:\n\n'+e.message); })
    .then(function(){ home._analyzing=false; saveHomes(); renderHomes(); });
}
function deleteHome(id){
  var h=findHome(id);
  if(!h) return;
  if(!confirm('Delete "'+(h.address||'this home')+'"?')) return;
  state.homes=state.homes.filter(function(x){return x.id!==id;});
  saveHomes(); renderHomes();
}

/* ============ Rendering: analysis ============ */
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
  h+='<div class="block-label">✨ X-Factors'+(n?' ('+n+')':'')+'</div>';
  if(n){
    h+='<div class="xfactors">'+a.x_factors.map(xfactorRowHtml).join('')+'</div>';
  }else{
    h+='<div class="muted-note">No standout X-factors detected.</div>';
  }
  var cs=a.criteria_scores||{}; var keys=Object.keys(cs);
  if(keys.length){
    h+='<div class="block-label">📋 Baseline Criteria</div><div class="criteria">';
    h+=keys.map(function(k){
      return '<div class="crit"><div class="crit-k">'+esc(prettyKey(k))
        +'</div><div class="crit-v">'+esc(String(cs[k]))+'</div></div>';
    }).join('');
    h+='</div>';
  }
  return h;
}

/* ============ Rendering: homes ============ */
function sortedHomes(){
  var hs=state.homes.slice();
  var by=state.sortBy;
  hs.sort(function(a,b){
    if(by==='xfactors') return xCount(b)-xCount(a);
    if(by==='price_desc') return (b.price||-1)-(a.price||-1);
    return (a.price==null?Infinity:a.price)-(b.price==null?Infinity:b.price);
  });
  return hs;
}
function homeCardHtml(h){
  var a=h.analysis;
  return '<div class="card home-card">'
    +'<div class="home-top"><div>'
      +'<div class="home-addr">'+esc(h.address||'(no address)')+'</div>'
      +(h.url?'<a class="home-link" href="'+esc(h.url)+'" target="_blank" rel="noopener">View listing ↗</a>':'')
    +'</div><div class="price-tag">'+fmtPrice(h.price)+'</div></div>'
    +(a?analysisHtml(a):'<div class="muted-note">Not analyzed yet.</div>')
    +(h.notes?'<div class="home-notes">📝 '+esc(h.notes)+'</div>':'')
    +'<div class="card-actions">'
      +'<button class="btn tiny primary" '+(h._analyzing?'disabled':'')+' data-action="analyze" data-id="'+h.id+'">'
        +(h._analyzing?'Analyzing…':(a?'↻ Re-analyze':'✨ Analyze'))+'</button>'
      +'<button class="btn tiny outline" data-action="edit" data-id="'+h.id+'">Edit</button>'
      +'<button class="btn tiny danger" data-action="delete" data-id="'+h.id+'">Delete</button>'
    +'</div></div>';
}
function detect(h,words){
  if(!h.analysis) return '—';
  var x=h.analysis.x_factors||[];
  for(var i=0;i<x.length;i++){
    var blob=((x[i].label||'')+' '+(x[i].emoji||'')+' '+(x[i].reason||'')).toLowerCase();
    for(var w=0;w<words.length;w++){ if(blob.indexOf(words[w])>-1) return '✅'; }
  }
  return '—';
}
function tableHtml(homes){
  var rows=homes.map(function(h){
    var a=h.analysis||{}; var cs=a.criteria_scores||{}; var xf=a.x_factors||[];
    return '<tr>'
      +'<td class="t-addr">'+esc(h.address||'—')+'</td>'
      +'<td>'+fmtPrice(h.price)+'</td>'
      +'<td>'+esc(cs.basement||'—')+'</td>'
      +'<td>'+esc(cs.backyard||'—')+'</td>'
      +'<td class="t-c">'+detect(h,['pool'])+'</td>'
      +'<td class="t-c">'+detect(h,['creek','stream','brook'])+'</td>'
      +'<td class="t-c">'+(xf.length||0)+'</td>'
      +'<td>'+(xf.length?xf.map(pillHtml).join(' '):'—')+'</td>'
    +'</tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead><tr>'
    +'<th>Address</th><th>Price</th><th>Basement</th><th>Backyard</th>'
    +'<th>Pool</th><th>Creek</th><th>#X</th><th>X-Factors</th>'
    +'</tr></thead><tbody>'+rows+'</tbody></table></div>';
}
function renderHomes(){
  el('homesCount').textContent = state.homes.length?state.homes.length:'';
  var homes=sortedHomes();
  var cards=el('homesCards'), table=el('homesTable');
  if(!homes.length){
    cards.innerHTML='<div class="empty">No saved homes yet.<br/>Add one with "+ Add Home", or analyze a listing and save it.</div>';
    table.innerHTML='';
    return;
  }
  cards.innerHTML=homes.map(homeCardHtml).join('');
  table.innerHTML=tableHtml(homes);
}
function setSort(v){ state.sortBy=v; renderHomes(); }
function toggleView(){
  state.viewMode = state.viewMode==='cards'?'table':'cards';
  var cards=el('homesCards'), table=el('homesTable'), btn=el('viewToggle');
  if(state.viewMode==='table'){
    cards.style.display='none'; table.style.display='block'; btn.textContent='▤ Card view';
  }else{
    cards.style.display='grid'; table.style.display='none'; btn.textContent='▦ Table view';
  }
}

/* ============ Rendering: neighborhoods & search ============ */
function renderNeighborhoods(){
  el('nbAnchor').textContent=state.anchor;
  el('nbList').innerHTML=NEIGHBORHOODS.map(function(n){
    var link='https://www.google.com/maps/dir/?api=1&origin='+encodeURIComponent(state.anchor)
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
  var zState={usersSearchTerm:'Atlanta, GA',
    filterState:{price:{max:700000},keywords:{value:'basement'}},isListVisible:true};
  var zillow='https://www.zillow.com/homes/for_sale/?searchQueryState='+encodeURIComponent(JSON.stringify(zState));
  var redfinBase='https://www.redfin.com/city/30772/GA/Atlanta/filter/';
  var redfinBasement=redfinBase+'max-price=700k,property-type=house,remarks=basement';
  var redfinPool=redfinBase+'max-price=700k,property-type=house,remarks=pool';
  var items=[
    {icon:'🟦',title:'Zillow — Atlanta, under $700k',desc:'Houses for sale matching the "basement" keyword.',url:zillow},
    {icon:'🟥',title:'Redfin — Atlanta, under $700k',desc:'Houses for sale with "basement" in the listing remarks.',url:redfinBasement},
    {icon:'🏊',title:'Redfin — Homes with a Pool',desc:'Atlanta houses under $700k mentioning "pool".',url:redfinPool}
  ];
  el('searchList').innerHTML=items.map(function(it){
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
  setVal('set_key',state.apiKey);
  setVal('set_model',state.model);
  setVal('set_anchor',state.anchor);
  el('sbAnchor').textContent=state.anchor;
  renderNeighborhoods();
  renderSearch();
  renderHomes();

  /* ---- Event listeners (replaces all inline onclick/onchange) ---- */
  // Sidebar nav
  var navBtns=document.querySelectorAll('.nav-item[data-sec]');
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
  el('modalSaveBtn').addEventListener('click', function(){ saveModal(false); });
  el('modalSaveAnalyzeBtn').addEventListener('click', function(){ saveModal(true); });

  // Homes toolbar
  el('addHomeBtn').addEventListener('click', function(){ openModal(); });
  el('sortSel').addEventListener('change', function(){ setSort(this.value); });
  el('viewToggle').addEventListener('click', toggleView);

  // Analyzer
  el('anAnalyzeBtn').addEventListener('click', runAnalyzer);
  el('anSaveBtn').addEventListener('click', saveAnalyzerToTracker);

  // Home card event delegation (analyze / edit / delete buttons)
  el('homesCards').addEventListener('click', function(e){
    var btn=e.target.closest('[data-action]');
    if(!btn) return;
    var action=btn.getAttribute('data-action');
    var id=btn.getAttribute('data-id');
    if(action==='analyze') analyzeHome(id);
    else if(action==='edit') openModal(id);
    else if(action==='delete') deleteHome(id);
  });

  // Keyboard: Escape closes modal / drawer
  document.addEventListener('keydown',function(e){
    if(e.key==='Escape'){
      if(el('modalOverlay').classList.contains('show')) closeModal();
      else if(el('drawer').classList.contains('open')) closeDrawer();
    }
  });
}
init();
