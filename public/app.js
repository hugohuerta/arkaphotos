import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const CFG = { VERSION: '0.3.1', MIGRACION_ESPERADA: 3, URL_TTL: 3600 };
const $ = id => document.getElementById(id);
const RX = /^(\d+)-([0-9a-fA-F]{32})-(\d{1,2})(?:\s*\((\d+)\))?\.(jpe?g|png)$/i;
const MAX = 32, BUCKET = 'arkaphoto';
const toast = m => { const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2000); };
const fmt = b => b>=1048576?(b/1048576).toFixed(2)+' MB':(b/1024).toFixed(0)+' KB';
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

$('verLogin').textContent = 'v'+CFG.VERSION; $('verChip').textContent = 'v'+CFG.VERSION;

// ---------- Supabase
let pub;
try{ const r = await fetch('/api/config'); pub = await r.json(); if(!r.ok || !pub.url) throw new Error(pub.error||('HTTP '+r.status)); }
catch(e){ ['vLogin','vApp','vGal'].forEach(id=>$(id).hidden = id!=='vLogin'); $('errEmail').textContent='No se pudo cargar la configuración: '+e.message; throw e; }
const sb = createClient(pub.url, pub.anonKey);
let session = null;

// URLs firmadas (bucket privado): una llamada por lote de rutas, válidas CFG.URL_TTL segundos
async function firmar(rutas){
  if(!rutas.length) return new Map();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(rutas, CFG.URL_TTL);
  if(error){ toast('No se pudieron firmar las URLs: '+error.message); return new Map(); }
  return new Map(data.map(d=>[d.path, d.signedUrl]));
}

// ---------- vistas
function show(v){ ['vLogin','vApp','vGal'].forEach(id=>$(id).hidden = id!==v); }
async function route(){
  const { data } = await sb.auth.getSession(); session = data.session;
  if(!session){ show('vLogin'); return; }
  $('who').textContent = session.user.email;
  if(location.hash === '#galeria'){ show('vGal'); await renderGaleria(); }
  else { show('vApp'); await cargarTodo(); }
}
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((ev)=>{ if(ev==='SIGNED_OUT') show('vLogin'); });

// ---------- login: código de 8 dígitos por Resend (/api/auth/*), sesión de Supabase vía token_hash
let emailPend = '', cooldownT = null;
const post = (url, body) => fetch(url,{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(body) }).then(async r=>({ ok:r.ok, status:r.status, j: await r.json().catch(()=>({})) }));

async function enviarCodigo(){
  const r = await post('/api/auth/send', { email: emailPend });
  if(!r.ok) throw new Error(r.j.error || `Error ${r.status}`);
  $('codeNote').textContent = `Enviamos un código de 8 dígitos a ${emailPend}. Caduca en ${r.j.ttl} minutos.`;
  iniciarCooldown(r.j.cooldown || 45);
}
function iniciarCooldown(s){
  clearInterval(cooldownT); const b=$('btnReenviar'); let n=s;
  b.disabled=true; b.textContent=`Reenviar en ${n} s`;
  cooldownT=setInterval(()=>{ n--; if(n<=0){ clearInterval(cooldownT); b.disabled=false; b.textContent='Reenviar código'; } else b.textContent=`Reenviar en ${n} s`; },1000);
}
$('fEmail').addEventListener('submit', async e=>{
  e.preventDefault(); $('errEmail').textContent=''; $('btnEnviar').disabled=true;
  emailPend = $('email').value.trim().toLowerCase();
  try{ await enviarCodigo(); $('fEmail').hidden=true; $('fCode').hidden=false; $('code').value=''; $('code').focus(); }
  catch(err){ $('errEmail').textContent = err.message; }
  $('btnEnviar').disabled=false;
});
$('btnReenviar').addEventListener('click', async ()=>{
  $('errCode').textContent='';
  try{ await enviarCodigo(); }catch(err){ $('errCode').textContent=err.message; }
});
$('code').addEventListener('input', e=>{ e.target.value = e.target.value.replace(/\D/g,'').slice(0,8); if(e.target.value.length===8) $('fCode').requestSubmit(); });
$('fCode').addEventListener('submit', async e=>{
  e.preventDefault(); $('errCode').textContent=''; $('btnVerificar').disabled=true;
  try{
    const r = await post('/api/auth/verify', { email: emailPend, code: $('code').value });
    if(!r.ok) throw new Error(r.j.error || `Error ${r.status}`);
    const { error } = await sb.auth.verifyOtp({ token_hash: r.j.token_hash, type: 'magiclink' });
    if(error) throw new Error('No se pudo abrir la sesión: '+error.message);
    $('code').value=''; $('fCode').hidden=true; $('fEmail').hidden=false; route();
  }catch(err){ $('errCode').textContent = err.message; }
  $('btnVerificar').disabled=false;
});
$('btnOtro').addEventListener('click', ()=>{ $('fCode').hidden=true; $('fEmail').hidden=false; $('errCode').textContent=''; });
$('btnSalir').addEventListener('click', async ()=>{ await sb.auth.signOut(); show('vLogin'); });

// ---------- estado
const cfg = { base:'', rango:'16' };
const lotes = new Map();   // key -> {ts,hash,ext,items:Map(seq->{url,origen,bytes,file?})}
const raw = new Map();     // archivos locales pendientes de subir (nombre -> File)
const bad = []; let dupes = [], lastMissing = [];

async function cargarTodo(){
  const { data: c } = await sb.from('arkaphoto_config').select('ruta_publica,rango').maybeSingle();
  cfg.base = (c?.ruta_publica||'').replace(/\/+$/,''); cfg.rango = c?.rango||'16';
  $('baseUrl').value = cfg.base; $('rango').value = cfg.rango;
  if(!cfg.base) $('cfg').open = true;
  await cargarImagenes(); render();
}
async function cargarImagenes(){
  lotes.clear();
  const { data, error } = await sb.from('arkaphoto_imagenes').select('lote,seq,ext,ruta,bytes,origen').order('lote').order('seq');
  if(error){ toast('Error leyendo imágenes: '+error.message); return; }
  const urls = await firmar(data.map(r=>r.ruta));
  for(const r of data){
    const [ts,hash] = r.lote.split('-');
    if(!lotes.has(r.lote)) lotes.set(r.lote,{ts,hash,ext:r.ext,items:new Map()});
    lotes.get(r.lote).items.set(r.seq,{url:urls.get(r.ruta)||'',origen:r.origen,bytes:r.bytes});
  }
}
$('fCfg').addEventListener('submit', async e=>{
  e.preventDefault();
  cfg.base = $('baseUrl').value.trim().replace(/\/+$/,''); cfg.rango = $('rango').value;
  const { error } = await sb.from('arkaphoto_config').upsert({ user_id: session.user.id, ruta_publica: cfg.base, rango: cfg.rango, actualizado: new Date().toISOString() });
  toast(error ? 'No se guardó: '+error.message : 'Configuración guardada'); render();
});

// ---------- carga local → resolver (n) → subir
const drop=$('drop'), input=$('files');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('over');}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('over');}));
drop.addEventListener('drop',e=>addFiles(e.dataTransfer.files));
drop.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();input.click();}});
input.addEventListener('change',()=>{addFiles(input.files);input.value='';});

async function addFiles(list){
  raw.clear(); dupes=[];
  for(const f of list){
    if(!RX.test(f.name)){ if(!bad.includes(f.name)) bad.push(f.name); continue; }
    if(!raw.has(f.name)) raw.set(f.name,f);
  }
  const elegidos = resolverDuplicados();
  await subir(elegidos);
  await cargarImagenes(); render();
}
function resolverDuplicados(){
  const grupos = new Map();
  for(const f of raw.values()){
    const m=f.name.match(RX);
    const canon = `${m[1]}-${m[2].toLowerCase()}-${parseInt(m[3],10)}.${m[5].toLowerCase()}`;
    if(!grupos.has(canon)) grupos.set(canon,{m,orig:null,copias:[]});
    const g=grupos.get(canon);
    if(m[4]===undefined) g.orig=f; else g.copias.push({file:f,idx:parseInt(m[4],10)});
  }
  const out=[];
  for(const [canon,g] of grupos){
    g.copias.sort((a,b)=>a.idx-b.idx);
    let elegido=g.orig;
    if(g.orig){
      for(const c of g.copias){
        if(c.file.size===g.orig.size) dupes.push({name:c.file.name,estado:'ignorada: mismo tamaño que la original',ok:true});
        else dupes.push({name:c.file.name,estado:`tamaño distinto (${fmt(c.file.size)} vs ${fmt(g.orig.size)}); se conservó la original, revisar`,ok:false});
      }
    } else if(g.copias.length){
      elegido=g.copias[0].file;
      dupes.push({name:elegido.name,estado:`no existe la original; se procesa como ${canon}`,ok:true});
      g.copias.slice(1).forEach(c=>dupes.push({name:c.file.name,estado:'ignorada: ya se tomó la primera copia',ok:true}));
    }
    if(elegido) out.push({file:elegido, m:g.m, canon});
  }
  return out;
}
async function subir(elegidos){
  let n=0;
  for(const {file,m,canon} of elegidos){
    const lote = `${m[1]}-${m[2].toLowerCase()}`, seq=parseInt(m[3],10), ext=m[5].toLowerCase();
    const ruta = `${session.user.id}/${lote}/${canon}`;
    $('upStatus').textContent = `Subiendo ${++n} de ${elegidos.length}: ${canon}`;
    const up = await sb.storage.from(BUCKET).upload(ruta, file, { upsert:true, contentType:file.type||(ext==='png'?'image/png':'image/jpeg') });
    if(up.error){ toast(`Falló ${canon}: ${up.error.message}`); continue; }
    const ins = await sb.from('arkaphoto_imagenes').upsert({ user_id:session.user.id, lote, seq, ext, nombre:canon, ruta, bytes:file.size, origen:'subida' }, { onConflict:'user_id,lote,seq' });
    if(ins.error) toast(`Subida pero sin registro ${canon}: ${ins.error.message}`);
  }
  $('upStatus').textContent = elegidos.length ? `${elegidos.length} imágenes subidas.` : '';
}

// ---------- lógica de faltantes
function rangoEsperado(L){
  const max = Math.max(...L.items.keys());
  if(cfg.rango==='32') return MAX;
  return Math.min(MAX, Math.ceil(max/16)*16);
}
function faltantes(L){ const h=rangoEsperado(L), o=[]; for(let i=1;i<=h;i++) if(!L.items.has(i)) o.push(i); return o; }
const nombre = (L,n) => `${L.ts}-${L.hash}-${n}.${L.ext}`;
const urlDe = (L,n) => (cfg.base?cfg.base+'/':'')+nombre(L,n);

// ---------- render
function render(){
  const nArch=[...lotes.values()].reduce((a,L)=>a+L.items.size,0);
  $('resumen').hidden = nArch===0 && bad.length===0;
  $('lotes').hidden = lotes.size===0;
  $('sArch').textContent=nArch; $('sLotes').textContent=lotes.size; $('sBad').textContent=bad.length; $('sDup').textContent=dupes.length;

  lastMissing=[]; let total=0;
  const frag=document.createDocumentFragment();
  for(const [key,L] of lotes){
    const miss=faltantes(L), hasta=rangoEsperado(L); total+=miss.length;
    miss.forEach(n=>lastMissing.push({key,L,n}));
    const d=document.createElement('div'); d.className='lote';
    d.innerHTML = `<div class="lote-head"><span class="key">${esc(key)}</span>
      <span class="pill ${miss.length?'miss':'ok'}">${miss.length?miss.length+' faltantes':'completo'}</span>
      <span class="pill warn">${L.items.size} de ${hasta}</span></div>`;
    const g=document.createElement('div'); g.className='seq';
    for(let i=1;i<=MAX;i++){
      const c=document.createElement('div'); c.className='cell'; c.dataset.n=i;
      const it=L.items.get(i);
      if(it){ c.classList.add('has'); if(it.origen==='traida') c.classList.add('traida'); const im=document.createElement('img'); im.loading='lazy'; im.src=it.url; im.alt=nombre(L,i); c.appendChild(im); }
      else if(i<=hasta){ c.classList.add('miss'); c.textContent=i; }
      else { c.classList.add('out'); c.textContent=i; }
      c.title=nombre(L,i)+(it?` · ${it.origen}`:i<=hasta?' · falta':' · fuera de rango');
      g.appendChild(c);
    }
    d.appendChild(g); frag.appendChild(d);
  }
  $('lotes').replaceChildren(frag);
  $('sFalt').textContent=total;
  $('pregunta').hidden = total===0; $('faltantes').hidden = true;
  if(total) $('preguntaTxt').textContent = `Hay ${total} imágenes faltantes en ${[...lotes.values()].filter(L=>faltantes(L).length).length} lote(s). ¿Quieres que validemos si existen en la ruta pública?`;

  $('noRec').hidden = bad.length===0; $('badList').textContent = bad.join('\n');
  $('dupSec').hidden = dupes.length===0;
  const dl=$('dupList'); dl.replaceChildren();
  dupes.forEach(d=>{ const li=document.createElement('li'); li.innerHTML=`<span class="n ${d.ok?'okc':''}">${d.ok?'✓':'!'}</span><span>${esc(d.name)}</span><span class="note">${esc(d.estado)}</span>`; dl.appendChild(li); });
}

$('btnSi').addEventListener('click',()=>{
  if(!cfg.base){ $('cfg').open=true; toast('Configura la ruta pública primero'); $('baseUrl').focus(); }
  const ul=$('missList'); ul.replaceChildren();
  lastMissing.forEach(({L,n})=>{ const li=document.createElement('li'); const u=urlDe(L,n);
    li.innerHTML=`<span class="n">${n}</span>`+(cfg.base?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`:`<span>${esc(nombre(L,n))}</span>`); ul.appendChild(li); });
  $('traerTxt').textContent=''; $('faltantes').hidden=false; $('pregunta').hidden=true;
  $('faltantes').scrollIntoView({behavior:'smooth',block:'start'});
});
$('btnNo').addEventListener('click',()=>{ $('pregunta').hidden=true; });
$('btnCopiar').addEventListener('click',()=>{
  const txt=lastMissing.map(({L,n})=>urlDe(L,n)).join('\n');
  navigator.clipboard?.writeText(txt).then(()=>toast('Lista copiada')).catch(()=>toast('No se pudo copiar'));
});

// ---------- TRAER a ARKAPHOTO (servidor)
$('btnTraer').addEventListener('click', async ()=>{
  if(!cfg.base){ $('cfg').open=true; toast('Configura la ruta pública primero'); return; }
  $('btnTraer').disabled=true;
  const porLote = new Map();
  lastMissing.forEach(({key,L,n})=>{ if(!porLote.has(key)) porLote.set(key,{ext:L.ext,seqs:[]}); porLote.get(key).seqs.push(n); });
  let ok=0, no=0; const fallas=[];
  for(const [lote,{ext,seqs}] of porLote){
    $('traerTxt').textContent=`Trayendo ${seqs.length} del lote ${lote}…`;
    try{
      const r = await fetch('/api/traer',{ method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}`}, body:JSON.stringify({lote,ext,seqs}) });
      const j = await r.json();
      if(!r.ok){ fallas.push(`${lote}: ${j.error||r.status}`); continue; }
      j.resultados.forEach(x=>{ if(x.ok) ok++; else { no++; fallas.push(`${lote}-${x.seq}: ${x.status===404?'no existe en la ruta':'HTTP '+x.status+(x.error?' '+x.error:'')}`); } });
    }catch(e){ fallas.push(`${lote}: ${e.message}`); }
  }
  await cargarImagenes(); render();
  $('faltantes').hidden=false; $('pregunta').hidden=true;
  $('traerTxt').textContent = `Traídas: ${ok}. No encontradas o con error: ${no}.` + (fallas.length?`\n${fallas.join('\n')}`:'');
  $('traerTxt').style.whiteSpace='pre-line';
  $('btnTraer').disabled=false;
});

// ---------- galería
async function renderGaleria(){
  await cargarImagenes();
  if(!$('baseUrl').value){ const { data: c } = await sb.from('arkaphoto_config').select('rango').maybeSingle(); cfg.rango=c?.rango||'16'; }
  let total=0, trai=0; const parts=[];
  for(const [key,L] of lotes){
    const hasta=rangoEsperado(L), cards=[];
    for(let i=1;i<=hasta;i++){
      const it=L.items.get(i);
      if(it){ total++; if(it.origen==='traida') trai++;
        cards.push(`<figure class="gc"><img loading="lazy" src="${esc(it.url)}" alt="${esc(nombre(L,i))}"><figcaption><b>${i}</b><span class="pill ${it.origen==='traida'?'ok':'warn'}">${it.origen}</span><a href="${esc(it.url)}" target="_blank" rel="noopener">abrir</a></figcaption></figure>`);
      } else cards.push(`<figure class="gc"><div class="cell miss" style="aspect-ratio:1;border:0;border-radius:0">${i}</div><figcaption><b>${i}</b><span class="pill miss">falta</span></figcaption></figure>`);
    }
    parts.push(`<section class="panel" style="margin-bottom:16px"><h2 class="key" style="text-transform:none;letter-spacing:0">${esc(key)} · ${L.items.size} de ${hasta}</h2><div class="gal">${cards.join('')}</div></section>`);
  }
  $('galBody').innerHTML = parts.join('') || '<p class="note">Aún no hay imágenes.</p>';
  $('galStats').textContent = `${total} imágenes · ${trai} traídas · ${lotes.size} lotes`;
}

route();
