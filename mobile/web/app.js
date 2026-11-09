'use strict';
const $=s=>document.querySelector(s), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cat='<svg viewBox="0 0 32 30" shape-rendering="crispEdges" aria-hidden="true"><path fill="#101e29" stroke="#90cdd2" stroke-width="2" d="M3 3h5v3h3v3h11V6h3V3h4v21h-4v3H8v-3H3z"/><path fill="#f2d3a7" d="M5 6h3v4h4v2h10V9h4V6h1v15h-4v3H9v-2H5z"/><path fill="#ca855f" d="M5 8h3v4h5v7H6z"/><path fill="#526675" d="M21 10h5v7h-6z"/><path fill="#142530" d="M8 15h4v3H8zm13 0h3v3h-3zm-7 4h5v2h-2v2h-2v-2h-1z"/></svg>';
$('#brandCat').innerHTML=cat;
const pin='<svg viewBox="0 0 32 40" aria-hidden="true"><path fill="currentColor" stroke="#112532" stroke-width="2" d="M3 5 9 8Q16 5 23 8l6-5v17q0 7-8 10l-5 7-5-7q-8-3-8-10z"/><path fill="#17313d" d="M7 11l4 2-4 2zm18 0-4 2 4 2zM9 17h4v3H9zm11 0h4v3h-4zm-6 4h5l-2.5 3z"/></svg>';
const rehearsalRoster=[['Laundry Lane',42,49,7,5,'Behind the laundromat'],['Buttonwood Row',15,25,6,4,'West park entrance'],['Heron Steps',35,17,5,4,'Library steps'],['Pelican Yard',56,26,8,7,'Bridge parking lot'],['Cypress Court',20,55,4,3,'Community garden'],['Biscuit Wharf',60,61,9,6,'Canal boat shed'],['Palm Pocket',30,79,3,2,'Plant nursery'],['Blue Lantern',52,85,5,3,'Market loading bay'],['Shell Key',84,42,4,4,'Beach picnic area']];
const connected = window.MEWS_CONNECTED === true;
let roster = connected ? [] : rehearsalRoster;
const day=new Date();day.setHours(0,0,0,0);const at=(h,m,d=0)=>new Date(+day+(h*60+m+d*1440)*60000).toISOString(),when=t=>new Date(t).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}), names=['Beatriz','Luz','Nico','Sol'];
function seed(){let reports=roster.map((c,i)=>({id:'base'+i,c:i,text:'Fed the colony and refilled the water bowls.',by:names[i%4],time:at(17,i*3,-1),submitted:at(18,i,-1),fed:true}));let issues=[];for(const [c,title,note] of [[2,'Pregnancy reported','A cat appears pregnant. Please arrange a welfare check.'],[5,'New kittens','Spotted three new kittens beside the shed.'],[7,'Feeder needed','I can no longer feed the cats at the market loading bay. A new feeder is needed.']]){let id='note'+c;reports.push({id,c,text:note,by:names[c%4],time:at(6,c*3),submitted:at(6,c*3)});issues.push({id:'issue'+c,c,title,source:id,status:'Open'})}return {reports,issues}}
let S=connected?{reports:[],issues:[],colonies:[],cats:[]}:seed(),revision=0,shared=false,selected=0,view='map',filter=false,zoom=1.35,activeEvidence=null,busy=false,loaded=false;
const issues=i=>S.issues.filter(x=>x.c===i&&x.status!=='Resolved'),feed=i=>S.reports.filter(x=>x.c===i&&x.fed).sort((a,b)=>b.time.localeCompare(a.time))[0],recent=()=>[...S.reports].sort((a,b)=>b.submitted.localeCompare(a.submitted)),key='mangrove.station.v3';
const demo=!connected && Boolean(window.MEWS_REHEARSAL);const hosted=!connected&&!demo&&!['localhost','127.0.0.1',''].includes(location.hostname);
let session={role:'founder',display:'Beatriz'};const isFounder=()=>session.role==='founder';
document.querySelector('.brand').onclick=e=>{e.preventDefault();navigate('map')};
function leaveDemo(){sessionStorage.removeItem('mews.demo.account');location.reload()}
async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (connected && session.userId) headers.set('X-Mews-User', session.userId);
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store', ...options, headers });
  if (response.status === 401) {
    location.replace('/login');
    throw Error('Your session expired. Please sign in again.');
  }
  const payload = await response.json().catch(() => null);
  if (payload?.error?.code === 'ACCOUNT_CHANGED') {
    setConnectionLabel('Account changed · refresh');
    throw Error('Your account changed in another tab. Refresh this page and check the signed-in name before sending.');
  }
  if (!response.ok) throw Error((typeof payload?.error === 'string' ? payload.error : payload?.error?.message) || 'Request failed (HTTP ' + response.status + ').');
  return payload?.data ?? payload;
}
function post(path, body) {
  return api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
let stateVersion = 0;
function useState(state) {
  if (!state || !Array.isArray(state.colonies) || !Array.isArray(state.reports) ||
      !Array.isArray(state.issues) || !Array.isArray(state.cats)) throw Error('The tracker returned incomplete records.');
  const visible = [];
  for (const colony of state.colonies) {
    visible[colony.c] = [colony.name, colony.x, colony.y, colony.total, colony.fixed, colony.label];
  }
  roster = visible;
  S = state;
  stateVersion++;
  if (!roster[selected]) selected = state.colonies[0]?.c ?? 0;
}
function setConnectionLabel(label) {
  const status = $('.status span');
  if (status) status.textContent = label;
}
async function leaveConnected() {
  try { await post('/api/tracker/logout', {}); location.replace('/login'); }
  catch (error) { toast(error.message); }
}
async function startConnected() {
  try {
    session = await api('/api/tracker/session');
    useState((await api('/api/tracker/state')).state);
    $('.operator').innerHTML = '<span>' + esc(session.display) + ' · ' + esc(session.role) +
      '</span><button id="accountOut">Sign out</button>';
    $('#accountOut').onclick = leaveConnected;
    loaded = true;
    setConnectionLabel('Connected to rescue');
    readRoute();
  } catch (error) {
    setConnectionLabel('Connection interrupted');
    $('#mainPane').innerHTML = '<p role="alert">' + esc(error.message) + '</p><button class="quiet" id="reconnect">Reconnect</button>';
    $('#reconnect').onclick = startConnected;
  }
}
async function init(){if(connected){await startConnected();return}if(demo){session=window.MEWS_REHEARSAL;try{S=JSON.parse(localStorage.getItem('mews.rehearsal.v1'))||seed()}catch{S=seed()}$('.operator').innerHTML='<span>'+esc(session.display)+' · '+esc(session.role)+'</span><button id="demoOut">Sign out</button>';$('#demoOut').onclick=leaveDemo;loaded=true;readRoute();return}if(hosted){try{const a=await fetch('/api/session',{cache:'no-store'});if(!a.ok)throw Error();session=await a.json();$('.operator').innerHTML='<i></i><span>'+esc(session.role==='founder'?'Founder':session.display)+'</span><a href="/signout-with-chatgpt?return_to=%2F" target="_top">Sign out</a>'}catch{location.replace('/');return}}try{let r=await fetch('/api/state',{cache:'no-store'});if(!r.ok)throw Error();let j=await r.json();shared=true;revision=j.revision;S=j.state||seed();if(!j.state)await save(S)}catch{if(hosted){document.querySelector('main').innerHTML='<h1>Tracker unavailable</h1><p>Reload to reconnect to the private tracker.</p>';return}if(!shared){try{S=JSON.parse(localStorage.getItem(key))||seed()}catch{}}}loaded=true;readRoute()}
async function save(next){if(connected)throw Error('Connected records must be saved through the rescue API.');if(shared){let r=await fetch('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({state:next,revision})});if(r.status===409){await refresh(true);throw Error('Another update arrived. Review the latest state and try again.')}if(!r.ok)throw Error('Could not save. Your report has not been sent.');revision=(await r.json()).revision}else localStorage.setItem(demo?'mews.rehearsal.v1':key,JSON.stringify(next));S=next}
let refreshing = false;
async function refresh(){if(connected){
  if(!loaded || refreshing || busy || $('#modal').open) return;
  refreshing = true;
  const beforeRefresh = stateVersion;
  try {
    const {state} = await api('/api/tracker/state');
    if (!busy && !$('#modal').open && beforeRefresh === stateVersion) { useState(state); draw(); }
    setConnectionLabel('Connected to rescue');
  } catch { setConnectionLabel('Connection lost · retrying'); }
  finally { refreshing = false; }
  return;
}if(!shared||busy||$('#modal').open)return;try{let j=await(await fetch('/api/state',{cache:'no-store'})).json();if(j.state&&j.revision!==revision){S=j.state;revision=j.revision;draw()}}catch{}}
function toast(s){$('#toast').textContent=s;clearTimeout(toast.t);toast.t=setTimeout(()=>$('#toast').textContent='',4800)}
function row(r){return '<button class="row" data-report="'+esc(r.id)+'"><span class="symbol">'+(r.vet?'✚':r.fed?'◒':'◇')+'</span><span class="grow"><strong>'+esc(roster[r.c][5])+'</strong><small>'+esc(r.text)+'</small></span><small>'+esc(when(r.time))+' ›</small></button>'}
const legend={emergency:'Emergency',normal:'No alerts',discovery:'New colony',followup:'Needs help'};
function condition(i){
 const open=issues(i);
 if(open.some(x=>/vet|pregnan|injur/i.test(x.title)))return 'emergency';
 const baseline=S.reports.find(x=>x.id==='base8')?.time;
 const discovered=Date.parse(S.discoveredAt?.[i]??(i===8?baseline:null));
 if(Number.isFinite(discovered)&&Date.now()-discovered<7*86400000)return 'discovery';
 return open.length?'followup':'normal';
}
let center={x:.5,y:.5};
function aim(i){center={x:roster[i][1]/100,y:roster[i][2]/100}}
let mapResize;
let renderCamera;
function bindMap() {
  const map = $('.map');
  const canvas = map.querySelector('.canvas');
  let width, height, worldWidth, worldHeight;
  let drag = null, pendingFrame = 0;

  function paint() {
    pendingFrame = 0;
    const tx = width / 2 - center.x * worldWidth * zoom;
    const ty = height / 2 - center.y * worldHeight * zoom;
    canvas.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + zoom + ')';
  }
  function moveCamera() {
    const halfX = width / (2 * worldWidth * zoom);
    const halfY = height / (2 * worldHeight * zoom);
    center.x = Math.min(1 - halfX, Math.max(halfX, center.x));
    center.y = Math.min(1 - halfY, Math.max(halfY, center.y));
    if (!pendingFrame) pendingFrame = requestAnimationFrame(paint);
  }
  function resize(w, h) {
    if (!w || !h || (width === w && height === h)) return;
    width = w;
    height = h;
    worldWidth = Math.max(w, h * 5 / 3);
    worldHeight = worldWidth * 3 / 5;
    canvas.style.width = worldWidth + 'px';
    canvas.style.height = worldHeight + 'px';
    moveCamera();
  }
  function pan(dx, dy) {
    center.x -= dx / (worldWidth * zoom);
    center.y -= dy / (worldHeight * zoom);
    moveCamera();
  }
  map.onpointerdown = event => {
    if (!event.isPrimary || event.button !== 0 || !event.target.closest('.canvas')) return;
    drag = {id: event.pointerId, x: event.clientX, y: event.clientY, moved: false};
  };
  map.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved) {
      if (Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      map.setPointerCapture(event.pointerId);
      map.classList.add('dragging');
    }
    pan(dx, dy);
    drag.x = event.clientX;
    drag.y = event.clientY;
  };
  function finish(event) {
    if (drag?.id !== event.pointerId) return;
    drag = null;
    map.classList.remove('dragging');
  }
  map.onpointerup = map.onpointercancel = finish;
  map.onlostpointercapture = event => {
    // Touch targets lose implicit capture when the parent takes over the drag.
    if (event.target === map) finish(event);
  };
  map.onpointerleave = event => { if (drag && !drag.moved) finish(event); };
  map.onkeydown = event => {
    if (event.target !== map) return;
    const delta = {ArrowLeft:[60,0], ArrowRight:[-60,0], ArrowUp:[0,60], ArrowDown:[0,-60]}[event.key];
    if (delta) { event.preventDefault(); pan(...delta); }
  };
  renderCamera = moveCamera;
  mapResize?.disconnect();
  resize(map.clientWidth, map.clientHeight);
  mapResize = new ResizeObserver(([entry]) => resize(entry.contentRect.width, entry.contentRect.height));
  mapResize.observe(map);
}
function careSummary(openIssues) {
  return openIssues.map(issue => {
    const report = S.reports.find(entry => entry.id === issue.source);
    const catName = report?.cat || (report?.calico ? 'Calico' : 'Cat');
    const label = /vet/i.test(issue.title) ? catName + ' needs a vet' : issue.title;
    return '<button class="issue" data-issue="' + esc(issue.id) + '">' + esc(label) + ' ›</button>';
  }).join('');
}
function draw(){if(connected && !S.colonies.length){
  mapResize?.disconnect();$('#mainPane').innerHTML='<p>No colonies assigned to this account.</p>';
  $('#detail').hidden=true;return;
}if(view!=='map')mapResize?.disconnect();document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));let r=roster[selected],needs=issues(selected),f=feed(selected);
if(view==='map'){
 const markers=roster.map((c,i)=>{
   if(filter&&!issues(i).length)return '';
   const k=condition(i),name=esc(c[5]),label=name+' · '+legend[k];
   return '<button aria-label="'+label+'" title="'+label+'" aria-pressed="'+(i===selected)+'" class="pin '+k+(i===selected?' on':'')+'" style="left:'+c[1]+'%;top:'+c[2]+'%" data-col="'+i+'">'+pin+(i===selected?'<label>'+name+'</label>':'')+'</button>';
 }).join('');
 if(!$('.map')) {
 $('#mainPane').innerHTML='<div class="map" role="region" tabindex="0" aria-label="Colony map. Drag or use arrow keys to pan."><div class="canvas"><img draggable="false" src="map.webp" alt="Illustrated map of the fictional Miami rescue sector"><div class="mapPins"></div></div><div class="maptool"><button class="urgentPill" data-urgent>Care alerts · 0</button></div><details class="mapSettings"><summary aria-label="Map controls">⌖</summary><div class="zoom"><button aria-label="Recenter map" data-center>⌖</button><button aria-label="Zoom out" data-zoom="-1">−</button><button aria-label="Zoom in" data-zoom="1">+</button></div></details></div><div class="mapfoot"><div class="maplegend">'+Object.entries(legend).map(([k,v])=>'<span class="'+k+'">● '+v+'</span>').join('')+'</div></div>';
   bindMap();
 }
 const pins=$('.mapPins');
 if(pins._markup!==markers){pins.innerHTML=markers;pins._markup=markers}
 $('.urgentPill').textContent='Care alerts · '+S.issues.filter(x=>x.status!=='Resolved').length;
 renderCamera();

}
if(view==='log')$('#mainPane').innerHTML='<div class="scroll">'+recent().map(row).join('')+'</div>';
if(view==='cats' && connected) $('#mainPane').innerHTML=connectedCats();
if(view==='cats' && !connected)$('#mainPane').innerHTML='<div class="cards"><button class="card" data-profile><img src="calico1.jpg" alt="Marigold, a fictional calico"><b>Marigold ›</b><small>Behind the laundromat · Confirmed cat</small></button></div>';
if(view==='colony') $('#mainPane').innerHTML=colonyPage(selected);
$('#detail').hidden=view!=='map';
if(view==='map') $('#detail').innerHTML='<div class="mapSelection"><strong>'+esc(r[5])+'</strong><a class="detailLink" href="#/colony/'+selected+'">Colony details →</a></div>';
$('.intro').hidden=view==='map';
$('.intro h1').textContent=({map:'',log:'Colony updates',cats:'Cat profiles',colony:r[5]})[view];
document.title=(view==='map'?'Colony map':$('.intro h1').textContent)+' | Mangrove Mews';
document.querySelectorAll('.rescueDock [data-view]').forEach(button=>{
  if(button.dataset.view===(view==='colony'?'map':view)) button.setAttribute('aria-current','page');
  else button.removeAttribute('aria-current');
});
}
function modal(title,html){let d=$('#modal');$('#modalBody').innerHTML='<div class="line"><div><h2>'+esc(title)+'</h2></div><button class="close" aria-label="Close" data-close>×</button></div>'+html;if(!d.open)d.showModal()}
function close(){ $('#modal').close();refresh() }
function evidence(r){return '<div class="evidence">'+(r.photo?'<img src="'+esc(r.photo)+'" alt="Submitted fictional cat sighting">':'')+'<p>“'+esc(r.text)+'”</p><small>'+esc(r.by)+' · '+esc(when(r.time))+'</small></div>'}
const analysisLabels = {
  seed: 'Sample record', pending: 'Awaiting analysis', live: 'Live OpenAI analysis',
  fixture: 'Fixture analysis', failed: 'Analysis failed', unavailable: 'Manual review · analysis unavailable',
};
function analysisEvidence(report, expanded = false) {
  const analysis = report.analysisEvidence;
  if (!isFounder() || !analysis || !['live','fixture'].includes(report.mode)) return '';
  function sources(ids) {
    return (ids || []).map(id => {
      if (id === report.id) return 'report text';
      const index = report.mediaIds.indexOf(id);
      return index < 0 ? null : 'photo ' + (index + 1);
    }).filter(Boolean).join(', ');
  }
  const observations = (analysis.observations || []).slice(0,4).map(item => {
    const refs = sources(item.evidenceIds);
    if (!refs) return '';
    const label = item.source === 'visual' ? 'Photo observation' : 'Reported observation';
    return '<li><b>' + label + '</b> · ' + esc(item.statement) + ' <small>(' + esc(refs) + ')</small></li>';
  }).join('');
  const matches = (analysis.candidates || []).slice(0,2).map(item => {
    const refs = sources(item.evidenceIds);
    const cat = S.cats.find(row => row.id === item.catId);
    if (!refs || !cat) return '';
    const reasons = (item.reasons || []).slice(0,2).join(' ');
    const conflicts = (item.contradictions || []).slice(0,2).join(' ');
    return '<li><b>Possible match · ' + esc(cat.name) + '</b> ' + esc(reasons) +
      (conflicts ? ' <strong>Conflicting details</strong> · ' + esc(conflicts) : '') +
      ' <small>(' + esc(refs) + ')</small></li>';
  }).join('');
  if (!observations && !matches) return '';
  const label = report.mode === 'live' ? 'Live analysis evidence' : 'Fixture analysis evidence';
  return '<details class="analysisEvidence"' + (expanded ? ' open' : '') + '><summary>' + label +
    '</summary><ul>' + observations + matches + '</ul></details>';
}
function connectedCats() {
  return '<div class="cards">' + (S.cats.map(cat => '<button class="card" data-cat="' + esc(cat.id) + '">' +
    (cat.photo ? '<img src="' + esc(cat.photo) + '" alt="Reference portrait of ' + esc(cat.name) + '">' : '') +
    '<b>' + esc(cat.name) + ' ›</b><small>' + esc(roster[cat.c][0]) + ' · Confirmed cat</small></button>').join('') ||
    '<p>No confirmed cats recorded.</p>') + '</div>';
}
function connectedProfile(id) {
  const cat = S.cats.find(entry => entry.id === id);
  if (!cat) { toast('Cat record unavailable.'); return; }
  const status = { fixed: 'Fixed', not_fixed: 'Awaiting TNR', unknown: 'TNR status unknown' }[cat.sterilization];
  const history = recent().filter(report => report.catId === id);
  modal(cat.name, (cat.photo ? '<div class="evidence"><img src="' + esc(cat.photo) + '" alt="Fictional reference photo"></div>' : '') +
    '<p>' + esc(roster[cat.c][0]) + ' · ' + esc(status) + (cat.vet ? ' · Vet review needed' : '') + '</p>' +
    '<div class="sect">Confirmed sightings</div>' + (history.map(row).join('') || '<p>No linked sightings visible.</p>'));
}
function displayReport(id) {
  const r = S.reports.find(report => report.id === id);
  if (!r) { toast('This report is unavailable.'); return; }
  selected = r.c; filter = false; zoom = 1.6; aim(selected); draw();
  const canReview = isFounder() && r.reviewable && !!r.photo && r.c === 0;
  const canRetry = isFounder() && (r.mode === 'failed' || r.status === 'failed');
  const status = r.cat ? 'Linked to ' + r.cat : r.reviewable ? 'Identity pending staff review' : r.status?.replaceAll('_', ' ');
  modal(roster[r.c][5], evidence(r) + '<p class="help">Received ' + esc(when(r.submitted)) +
    (analysisLabels[r.mode] ? ' · ' + esc(analysisLabels[r.mode]) : '') + '</p>' + (status ? '<p class="badge">' + esc(status) + '</p>' : '') +
    analysisEvidence(r, true) + (canReview ? '<button class="quiet" data-review="' + esc(id) + '">Compare cat photos →</button>' : '') +
    (canRetry ? '<button class="quiet" data-retry="' + esc(id) + '">Retry report analysis</button>' : '') +
    S.issues.filter(x => x.source === id).map(x => '<button class="issue" data-issue="' + esc(x.id) + '">' +
      esc(x.title) + ' · ' + esc(x.status) + '</button>').join(''));
}
function showReport(id){if(connected){displayReport(id);return}let r=S.reports.find(x=>x.id===id);selected=r.c;filter=false;zoom=1.6;aim(selected);draw();modal(roster[r.c][5],evidence(r)+'<p class="help">Received '+esc(when(r.submitted))+(r.mode?' · '+esc(r.mode):' · Sample update')+'</p>'+(r.calico?(r.cat?'<p class="badge">Confirmed · Marigold</p>':!isFounder()?'<p class="badge">Awaiting founder review</p>':'<button class="quiet" data-review="'+esc(r.id)+'">Check cat match →</button>'):'')+S.issues.filter(x=>x.source===id).map(x=>'<button class="issue" data-issue="'+esc(x.id)+'">'+esc(x.title)+' · '+esc(x.status)+'</button>').join(''))}
function connectedReview(id) {
  const report = S.reports.find(r => r.id === id && r.reviewable);
  const cat = S.cats.find(c => c.id === 'marigold');
  if (!report?.photo || !cat || report.c !== cat.c) { toast('This sighting is unavailable for review.'); return; }
  const other = recent().find(r => r.id !== id && r.c === report.c && r.photo &&
    (r.reviewable || r.catId === cat.id) && !r.rejected);
  const candidate = report.candidateIds?.includes(cat.id);
  const comparison = other ? evidence(other) :
    '<div class="evidence"><img src="' + esc(cat.photo || '/api/tracker/reference/marigold') + '" alt="Marigold’s reference portrait"><small>Marigold · Confirmed reference</small></div>';
  modal('Check cat match', '<p>' + (candidate ? 'The analysis suggested Marigold.' : 'Manual review requested.') +
    ' Compare the photos and field notes before linking these sightings to Marigold.</p><div class="pair">' +
    comparison + evidence(report) + '</div>' + analysisEvidence(report) + '<div class="tools"><button class="primary" data-match="' +
    esc(id) + '" data-other="' + esc(other?.reviewable ? other.id : '') + '">Same cat · Link to Marigold</button>' +
    '<button class="quiet" data-close>Decide later</button></div>');
}
function review(id){if(!isFounder())return;if(connected){connectedReview(id);return}let r=S.reports.find(x=>x.id===id),others=recent().filter(x=>x.id!==id&&x.c===r.c&&x.calico&&x.photo&&!x.rejected),a=others[0];modal('Check cat match','<p>Compare the original observations with Marigold’s markings: split ginger and black face, white blaze, and white paws.</p><div class="pair">'+(a?evidence(a):'<div class="evidence"><img src="calico1.jpg" alt="Marigold reference portrait"><small>Marigold · Confirmed roster photo</small></div>')+evidence(r)+'</div><p class="help">Confirming links these observations to Marigold. The census and care alerts stay unchanged.</p><div class="tools"><button class="primary" data-match="'+esc(id)+'" data-other="'+esc(a?.id||'')+'">Same cat</button><button class="quiet" data-close>Decide later</button></div>')}
function profile(){if(connected){connectedProfile('marigold');return}modal('Marigold','<div class="evidence"><img style="max-height:220px;object-fit:cover" src="calico1.jpg" alt="Fictional calico Marigold"></div><p>Behind the laundromat · Fixed · Calico with a white blaze and white paws.</p><div class="sect">Confirmed sightings</div>'+(recent().filter(x=>x.cat==='Marigold').map(row).join('')||'<p>No linked field reports yet.</p>'))}
function accountPage() {
  const original = $('.operator');
  const mode = {fixture:'Fixture analysis',live:'Live OpenAI enabled',manual:'Manual review'}[session.analysisMode];
  modal('Account', '<p>'+esc(session.display)+' · '+esc(session.role)+'</p>' + (connected && mode ? '<p>' + esc(mode) + '</p>' : ''));
  const signOut = original.querySelector('button, a');
  if(signOut){
    const copy = signOut.cloneNode(true);
    copy.removeAttribute('id');
    copy.className = 'quiet';
    if(demo) copy.onclick = leaveDemo;
    if(connected) copy.onclick = leaveConnected;
    $('#modalBody').append(copy);
  }
}
function navigate(path) {
  const hash = '#/' + path;
  if(location.hash === hash) readRoute();
  else location.hash = hash;
}
function readRoute() {
  if(!loaded) return;
  if($('#modal').open) $('#modal').close();
  const path = location.hash.slice(2);
  const colony = /^colony\/(\d+)$/.exec(path);
  if(colony && roster[Number(colony[1])]) {
    selected = Number(colony[1]);
    view = 'colony';
  } else view = ['log','cats'].includes(path) ? path : 'map';
  draw();
  window.scrollTo(0,0);
  if(view!=='map') $('.intro h1').focus({preventScroll:true});
}
window.addEventListener('hashchange',readRoute);
function colonyPage(index) {
  const colony = roster[index];
  const open = issues(index);
  const urgent = open.filter(issue => /vet|pregnan|injur/i.test(issue.title));
  const other = open.filter(issue => !urgent.includes(issue));
  const reports = recent().filter(report => report.c === index);
  const pending = reports.filter(report => connected ? report.reviewable : report.calico && !report.cat && !report.rejected);
  const info = connected && S.colonies.find(c => c.c === index);
  const stats = info ? [[info.total,'Total cats'],[info.fixed,'Fixed'],[info.tnr,'Awaiting TNR'],[info.unknown,'TNR unknown'],[info.vet,'Need vet review']] :
    [[colony[3],'Total cats'],[colony[4],'Fixed'],[colony[3]-colony[4],'Not yet fixed']];
  const last = info ? (info.lastFedAt && {time:info.lastFedAt,by:info.lastFeeder || 'Feeder unknown'}) : feed(index);
  const attention = [];
  if(urgent.length) attention.push('<div class="urgentCare"><h3>Urgent care</h3>'+careSummary(urgent)+'</div>');
  if(other.length) attention.push('<h3>Immediate needs</h3>'+careSummary(other));
  if(pending.length) {
    attention.push('<h3>Cat matches to review</h3>'+pending.map(report =>
      '<button class="reviewRow" data-report="'+esc(report.id)+'">'+esc(report.by)+'’s sighting · '+esc(when(report.time))+' ›</button>').join(''));
  }
  return '<article class="colonyPage"><section class="attention"><h2>Needs attention</h2>'+
    (attention.join('')||'<p>No open care needs or pending reviews.</p>')+'</section>'+
    '<section><h2>Colony overview</h2><div class="stats">'+stats.map(([value, label]) =>
      '<div class="kv"><b>'+esc(value)+'</b><small>'+esc(label)+'</small></div>').join('')+
    '</div><h3>Last feeding</h3><p>'+(last?esc(last.by)+' · '+esc(when(last.time)):'No feeding reported yet.')+'</p>'+
    (index===0&&(!connected||S.cats.some(cat=>cat.id==='marigold'))?'<button class="link" data-profile>Marigold’s profile →</button>':'')+'</section>'+
    '<section><h2>Colony updates</h2>'+reports.map(row).join('')+'</section></article>';
}
function issue(id){let x=S.issues.find(x=>x.id===id),r=S.reports.find(t=>t.id===x.source);selected=x.c;aim(selected);draw();modal(x.title,'<p class="badge">'+esc(x.status)+' · '+esc(roster[x.c][5])+'</p>'+(r?evidence(r):'<p>Source report restricted to the reporter and staff.</p>')+(x.status==='Resolved'||!isFounder()?'':'<div class="tools">'+(x.status==='Open'?'<button class="quiet" data-claim="'+esc(id)+'">Assign to Beatriz</button>':'')+'<button class="primary" data-resolve="'+esc(id)+'">Resolve issue</button></div>'))}
function urgent(){modal('Open care alerts',S.issues.filter(x=>x.status!=='Resolved').map(x=>'<button class="issue" data-issue="'+esc(x.id)+'">⚠ '+esc(x.title)+'<br><small>'+esc(roster[x.c][5])+' · '+esc(x.status)+'</small></button>').join('')||'<p>No open issues.</p>')}
function localDate(d){let a=new Date(d);return new Date(+a-a.getTimezoneOffset()*60000).toISOString().slice(0,16)}
function requestId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-');
}

function connectedForm() {
  if (!S.colonies.length) { toast('No colonies assigned to this account.'); return; }
  const laundry = S.colonies.find(colony => colony.c === 0);
  const options = S.colonies.map(colony => '<option value="' + esc(colony.c) + '"' +
    (colony.c === selected ? ' selected' : '') + '>' + esc(colony.name) + '</option>').join('');
  const sampleButtons = laundry ? '<div class="tools"><button type="button" class="sample" id="sample">Use feeding + limp sample</button>' +
    '<button type="button" class="sample" id="sample2">Use second sighting</button></div>' : '';
  modal('Send an update', '<form id="reportForm"><p class="help">Use fictional notes, photos and locations.</p>' + sampleButtons +
    '<label>Colony<select name="col">' + options + '</select></label>' +
    '<label><span><input name="shareLocation" type="checkbox"> Include this colony’s fictional location</span></label>' +
    '<label>When did you see this?<input required name="time" type="datetime-local" value="' + localDate(new Date()) + '"></label>' +
    '<label>What happened?<textarea required maxlength="1600" name="message" placeholder="Who did you see? What needs attention?"></textarea></label>' +
    '<label>Add a fictional photo (optional)<input name="photo" type="file" accept="image/jpeg,image/png"></label>' +
    '<div id="photoHint" class="help"></div><div id="formError" class="help" role="alert"></div>' +
    '<button class="primary" type="submit">Send report →</button></form>');
  const form = $('#reportForm');
  const fields = form.elements;
  let samplePhoto = null;
  let cachedPhoto = null;
  let lastPayload = '';
  let clientRequestId = requestId();
  function setSample(second) {
    fields.col.value = String(laundry.c);
    fields.shareLocation.checked = true;
    fields.time.value = localDate(at(7, second ? 35 : 10));
    fields.message.value = second ? 'Saw the same calico by the laundry steps. White paws and a ginger patch beside her nose.' :
      'Fed the cats behind the laundromat at 7:10. The calico is limping.';
    fields.photo.value = '';
    samplePhoto = second ? 'calico2.jpg' : 'calico1.jpg';
    $('#photoHint').innerHTML = '<img width="96" src="' + samplePhoto + '" alt="Synthetic calico sighting"> · Sample photo attached';
    $('#formError').textContent = '';
  }
  if (laundry) {
    $('#sample').onclick = () => setSample(false);
    $('#sample2').onclick = () => setSample(true);
  }
  fields.photo.onchange = () => {
    samplePhoto = null;
    $('#photoHint').textContent = fields.photo.files[0]?.name || '';
  };
  form.onsubmit = async event => {
    event.preventDefault();
    if (busy) return;
    busy = true;
    const button = form.querySelector('[type=submit]');
    const c = Number(fields.col.value);
    const colony = S.colonies.find(item => item.c === c);
    const text = fields.message.value.trim();
    const time = fields.time.value;
    const selectedPhoto = fields.photo.files[0] || samplePhoto;
    const demoLocationId = fields.shareLocation.checked ? colony?.demoLocationId : undefined;
    for (const field of fields) field.disabled = true;
    $('#formError').textContent = '';
    try {
      if (!text || !colony) throw Error('Choose a colony and write a short update.');
      if (selectedPhoto !== cachedPhoto?.source) cachedPhoto = null;
      if (selectedPhoto && !cachedPhoto) {
        button.textContent = 'Uploading photo…';
        let blob = selectedPhoto;
        if (typeof selectedPhoto === 'string') {
          const response = await fetch(selectedPhoto, { credentials: 'same-origin' });
          if (!response.ok) throw Error('The sample photo could not be loaded.');
          blob = new Blob([await response.arrayBuffer()], {type:'image/jpeg'});
        }
        if (!['image/jpeg','image/png'].includes(blob.type) || blob.size > 5 * 1024 * 1024)
          throw Error('Choose a JPEG or PNG no larger than 5 MB.');
        const {id} = await api('/api/media', {method:'POST',headers:{'Content-Type':blob.type},body:blob});
        if (!id) throw Error('The server did not confirm the upload.');
        cachedPhoto = { source:selectedPhoto, id };
      }
      button.textContent = 'Saving report…';
      const payload = {c, text, time:new Date(time).toISOString(), mediaIds:cachedPhoto ? [cachedPhoto.id] : [], demoLocationId};
      const serialized = JSON.stringify(payload);
      if (lastPayload && serialized !== lastPayload) clientRequestId = requestId();
      lastPayload = serialized;
      const receipt = await post('/api/tracker/reports', { ...payload, clientRequestId });
      if (!receipt.reportId) throw Error('Receipt unavailable. Retry this draft to retrieve it.');
      useState(receipt.state);
      const report = S.reports.find(row => row.id === receipt.reportId);
      const alerts = S.issues.filter(issue => issue.source === receipt.reportId);
      selected = c; aim(c); view = 'map'; filter = false; history.replaceState(null, '', '#/map'); draw();
      modal('Report received', '<p><b>' + esc(colony.name) + '</b> · ' + esc(session.display) + '</p><p>' + esc(text) +
        '</p>' + alerts.map(issue => '<p class="badge">' + esc(issue.title) + '</p>').join('') +
        '<p class="help">Saved to the rescue tracker' + (analysisLabels[report?.mode] ? ' · ' + esc(analysisLabels[report.mode]) : '') +
        '</p><button class="primary" data-close>Back to tracker</button>');
    } catch (error) {
      $('#formError').textContent = error.message;
      for (const field of fields) field.disabled = false;
      button.textContent = 'Retry report →';
    } finally { busy = false; }
  };
}
function form(){if(connected){connectedForm();return}activeEvidence=null;let second=S.reports.some(r=>r.calico&&r.c===0);modal('Send an update','<form id="reportForm"><p class="help">Use made-up notes and photos for this demo.</p><button type="button" class="sample" id="sample">Use sample '+(second?'sighting':'feeding update')+'</button><div class="pair"><label>Colony<select name="col">'+roster.map((r,i)=>'<option '+(i===selected?'selected':'')+' value="'+i+'">'+esc(r[5])+'</option>').join('')+'</select></label><label>Reported by<select name="by">'+names.map(n=>'<option>'+n+'</option>').join('')+'</select></label></div><label>When did you see this?<input name="time" required type="datetime-local" value="'+localDate(new Date())+'"></label><label>What happened?<textarea required maxlength="1600" name="message" placeholder="Who did you see? What needs attention?"></textarea></label><label>Add a photo (optional)<input name="photo" type="file" accept="image/jpeg,image/png,image/webp"></label><div id="photoHint" class="help"></div><div class="help" role="alert" id="formError"></div><button class="primary" type="submit">Send report →</button></form>');let f=$('#reportForm');if(demo||!isFounder()){f.by.replaceChildren(new Option(session.display,session.display));f.by.disabled=true}$('#sample').onclick=()=>{f.col.value=0;if(isFounder()&&!demo)f.by.value=second?'Nico':'Luz';f.time.value=localDate(at(7,second?35:10));f.message.value=second?'Saw the same calico by the laundry steps. White paws and a ginger patch beside her nose.':'Fed the cats behind the laundromat at 7:10. The calico is limping.';activeEvidence=second?'calico2.jpg':'calico1.jpg';f.photo.value='';$('#photoHint').innerHTML='<img width="96" src="'+activeEvidence+'" alt="Demo sighting attached"> · Demo photo attached'};f.photo.onchange=()=>{activeEvidence=null;$('#photoHint').textContent=''};f.onsubmit=submit}
async function getPhoto(file){if(!file)return activeEvidence;if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>8e6)throw Error('Choose a JPG, PNG or WebP under 8 MB.');let b=await createImageBitmap(file),canvas=document.createElement('canvas'),ratio=Math.min(1,720/Math.max(b.width,b.height));canvas.width=Math.max(1,b.width*ratio);canvas.height=Math.max(1,b.height*ratio);canvas.getContext('2d').drawImage(b,0,0,canvas.width,canvas.height);b.close();return canvas.toDataURL('image/jpeg',.72)}
function rules(m){return {fed:/\b(fed|refilled|gave food)\b/i.test(m)&&!/(not|never|wasn't|haven't) fed/i.test(m),vet:/limp|injur|bleed|wound|hurt|needs? (a )?vet/i.test(m),calico:/calico/i.test(m),mode:'rules'}}
async function submit(e){e.preventDefault();if(busy)return;busy=true;let f=e.target,b=f.querySelector('[type=submit]');b.disabled=true;b.textContent='Saving…';try{let c=+f.col.value,msg=f.message.value.trim();if(!msg)throw Error('Write a short update.');let photo=await getPhoto(f.photo.files[0]),ai=rules(msg);if(shared){let res=await fetch('/api/interpret',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:msg,colony:roster[c][0],photo})});if(res.ok){let j=await res.json();if(typeof j.fed==='boolean')ai=j}}let id=requestId(),r={id,c,by:f.by.value,time:new Date(f.time.value).toISOString(),submitted:new Date().toISOString(),text:msg,photo,fed:!!ai.fed,vet:!!ai.vet,calico:!!ai.calico&&c===0,mode:ai.mode==='live'?'Live OpenAI agent':'Demo rules'};let next=structuredClone(S);next.reports.push(r);if(/\b(newly discovered|just discovered|new) colony\b/i.test(msg)){next.discoveredAt={...next.discoveredAt,[c]:r.time}}let title=r.vet?'Needs vet attention':/pregnan/i.test(msg)?'Pregnancy reported':/kitten/i.test(msg)?'New kittens':/no longer.*feed|lost.*feeder|new feeder|feeder needed/i.test(msg)?'Feeder needed':null;if(title)next.issues.push({id:'i'+id,c,title,source:id,status:'Open'});if(!isFounder()&&hosted){const saved=await fetch('/api/reports',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({c,text:msg,time:r.time,photo})});const val=await saved.json();if(!saved.ok)throw Error(val.error||'Could not save report.');S=val.state;revision=val.revision;r=val.report;id=r.id;title=val.title}else await save(next);selected=c;aim(c);view='map';history.replaceState(null,'','#/map');filter=false;draw();modal('Report received','<p><b>'+esc(roster[c][5])+'</b> · '+esc(r.by)+'</p><p>'+esc(msg)+'</p><p>'+[r.fed?'Feeding recorded':null,title?'Alert opened: '+title:null,r.calico?'Founder to confirm which cat':null].filter(Boolean).map(esc).join(' · ')+'</p><p class="help">'+esc(r.mode)+' · Received '+esc(when(r.submitted))+'</p><div class="tools">'+(r.calico&&isFounder()?'<button class="quiet" data-review="'+id+'">Check cat match</button>':'')+'<button class="primary" data-close>Back to tracker</button></div>')}catch(err){$('#formError').textContent=err.message;b.disabled=false;b.textContent='Retry report →'}finally{busy=false}}
async function handleConnectedAction(button, data) {
  let url, payload;
  if (data.match) {
    url = '/api/tracker/match';
    payload = {reportIds:[data.match, data.other].filter(Boolean)};
  } else if (data.retry) {
    url = '/api/tracker/reports/' + encodeURIComponent(data.retry) + '/retry';
    payload = {};
  } else {
    url = '/api/tracker/issues/' + encodeURIComponent(data.claim || data.resolve) + '/' + (data.claim ? 'claim' : 'resolve');
    payload = {};
  }
  busy = true;
  button.disabled = true;
  try {
    const result = await post(url, payload);
    useState(result.state || (await api('/api/tracker/state')).state);
    draw();
    if (data.match) { connectedProfile('marigold'); toast('Sighting linked to Marigold'); }
    else if (data.retry) { displayReport(data.retry); toast('Analysis retry requested'); }
    else if (S.issues.some(issue => issue.id === (data.claim || data.resolve))) issue(data.claim || data.resolve);
    else { close(); toast('Care issue updated'); }
  } finally {
    busy = false;
    button.disabled = false;
  }
}
document.addEventListener('click',async e=>{let b=e.target.closest('button');if(!b||busy)return;let d=b.dataset;try{if(b.id==='send'){if(loaded)form()}else if(d.view){navigate(d.view)}else if('account' in d){accountPage()}else if(d.close!==undefined)close();else if(d.col!==undefined){selected=+d.col;draw()}else if('urgent' in d){urgent()}else if(d.filter){filter=d.filter==='urgent';draw();if(filter)urgent()}else if(d.center!==undefined){center={x:.5,y:.5};zoom=1.35;renderCamera()}else if(d.zoom){zoom=Math.max(1,Math.min(3,zoom+Number(d.zoom)*.35));renderCamera()}else if(d.report)showReport(d.report);else if(d.issue)issue(d.issue);else if(d.summary!==undefined)navigate('colony/'+selected);else if(connected&&d.cat)connectedProfile(d.cat);else if(d.profile!==undefined)profile();else if(d.review)review(d.review);else if(connected&&(d.match||d.retry||d.claim||d.resolve))await handleConnectedAction(b,d);else if(d.match){b.disabled=true;let next=structuredClone(S);for(let r of next.reports)if(r.id===d.match||r.id===d.other)r.cat='Marigold';await save(next);draw();profile();toast('Sightings linked · Census stays at 7')}else if(d.claim||d.resolve){let id=d.claim||d.resolve,next=structuredClone(S);next.issues.find(x=>x.id===id).status=d.claim?'Assigned to Beatriz':'Resolved';await save(next);draw();issue(id)}}catch(err){toast(err.message);b.disabled=false}});
$('#modal').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
init();setInterval(refresh,8000);window.addEventListener('focus',refresh);
