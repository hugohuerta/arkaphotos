import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const CFG = { VERSION: '0.4.0', MIGRACION_ESPERADA: 5, URL_TTL: 3600 };
const $ = id => document.getElementById(id);
const RX = /^(\d+)-([0-9a-fA-F]{32})-(\d{1,2})(?:\s*\((\d+)\))?\.(jpe?g|png)$/i;
const MAX = 32, BUCKET = 'arkaphoto';
const VISTAS = ['inicio','galerias','carga','urls','admin'];
const toast = m => { const t=$('toast'); t.textContent=m; t.classList.add('show'); setTimeout(()=>t.classList.remove('show'),2200); };
const fmt = b => b>=1073741824?(b/1073741824).toFixed(2)+' GB':b>=1048576?(b/1048576).toFixed(1)+' MB':(b/1024).toFixed(0)+' KB';
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

$('verLogin').textContent = 'v'+CFG.VERSION; $('verChip').textContent = 'v'+CFG.VERSION;

// ---------- Supabase
let pub;
try{ const r = await fetch('/api/config'); pub = await r.json(); if(!r.ok || !pub.url) throw new Error(pub.error||('HTTP '+r.status)); }
catch(e){ ['vLogin','vApp'].forEach(id=>$(id).hidden = id!=='vLogin'); $('errEmail').textContent='No se pudo cargar la configuración: '+e.message; throw e; }
const sb = createClient(pub.url, pub.anonKey);
let session = null;

// ---------- estado
const cfg = { base:'', rango:'16', tarifa:0.021, gbInc:1 };
const lotes = new Map();   // key -> {ts,hash,ext,items:Map(seq->{id,url,origen,bytes,favorita,ruta})}
const raw = new Map();     // archivos locales pendientes de subir (nombre -> File)
const bad = []; let dupes = [], lastMissing = [], galFiltro = 'todos';

// ---------- rutas / vistas
function show(v){ ['vLogin','vApp'].forEach(id=>$(id).hidden = id!==v); }
function vistaActual(){ const h=location.hash.replace('#',''); return VISTAS.includes(h)?h:'inicio'; }
async function route(){
  const { data } = await sb.auth.getSession(); session = data.session;
  if(!session){ show('vLogin'); return; }
  $('who').textContent = session.user.email;
  show('vApp');
  const v = vistaActual();
  document.querySelectorAll('[data-view]').forEach(s=>s.hidden = s.id!=='v-'+v);
  document.querySelectorAll('#menu a').forEach(a=>a.classList.toggle('on', a.dataset.v===v));
  if(!lotes.size) await cargarTodo();
  if(v==='inicio') renderInicio();
  if(v==='galerias') renderGalerias();
  if(v==='carga') render();
  if(v==='admin') { await renderMigraciones(); }
}
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((ev)=>{ if(ev==='SIGNED_OUT') show('vLogin'); });

// ---------- login: código de 8 dígitos por Resend (/api/auth/*), sesión Supabase vía token_hash
let emailPend = '', cooldownT = null;
const post = (url, body, auth=false) => fetch(url,{ method:'POST', headers:{'Content-Type':'application/json', ...(auth?{Authorization:`Bearer ${session.access_token}`}:{})}, body:JSON.stringify(body) }).then(async r=>({ ok:r.ok, status:r.status, j: await r.json().catch(()=>({})) }));

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
$('btnReenviar').addEventListener('click', async ()=>{ $('errCode').textContent=''; try{ await enviarCodigo(); }catch(err){ $('errCode').textContent=err.message; } });
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
$('btnSalir').addEventListener('click', async ()=>{ await sb.auth.signOut(); lotes.clear(); show('vLogin'); });

// ---------- datos
async function cargarTodo(){
  const { data: c } = await sb.from('arkaphoto_config').select('ruta_publica,rango,tarifa_gb_usd,gb_incluidos').maybeSingle();
  cfg.base = (c?.ruta_publica||'').replace(/\/+$/,''); cfg.rango = c?.rango||'16';
  cfg.tarifa = Number(c?.tarifa_gb_usd ?? 0.021); cfg.gbInc = Number(c?.gb_incluidos ?? 1);
  $('baseUrl').value = cfg.base; $('rango').value = cfg.rango; $('tarifa').value = cfg.tarifa; $('gbInc').value = cfg.gbInc;
  await cargarImagenes();
}
async function firmar(rutas){
  if(!rutas.length) return new Map();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(rutas, CFG.URL_TTL);
  if(error){ toast('No se pudieron firmar las URLs: '+error.message); return new Map(); }
  return new Map(data.map(d=>[d.path, d.signedUrl]));
}
async function cargarImagenes(){
  lotes.clear();
  const { data, error } = await sb.from('arkaphoto_imagenes').select('id,lote,seq,ext,ruta,bytes,origen,favorita').order('lote').order('seq');
  if(error){ toast('Error leyendo imágenes: '+error.message); return; }
  const urls = await firmar(data.map(r=>r.ruta));
  for(const r of data){
    const [ts,hash] = r.lote.split('-');
    if(!lotes.has(r.lote)) lotes.set(r.lote,{ts,hash,ext:r.ext,items:new Map()});
    lotes.get(r.lote).items.set(r.seq,{id:r.id,url:urls.get(r.ruta)||'',origen:r.origen,bytes:r.bytes||0,favorita:!!r.favorita,ruta:r.ruta});
  }
}
$('fCfg').addEventListener('submit', async e=>{
  e.preventDefault();
  cfg.base = $('baseUrl').value.trim().replace(/\/+$/,''); cfg.rango = $('rango').value;
  cfg.tarifa = parseFloat($('tarifa').value)||0; cfg.gbInc = parseFloat($('gbInc').value)||0;
  const { error } = await sb.from('arkaphoto_config').upsert({ user_id: session.user.id, ruta_publica: cfg.base, rango: cfg.rango, tarifa_gb_usd: cfg.tarifa, gb_incluidos: cfg.gbInc, actualizado: new Date().toISOString() });
  toast(error ? 'No se guardó: '+error.message : 'Configuración guardada');
});

// ---------- lógica de lotes
function rangoEsperado(L){ const max = Math.max(...L.items.keys()); return cfg.rango==='32' ? MAX : Math.min(MAX, Math.ceil(max/16)*16); }
function faltantes(L){ const h=rangoEsperado(L), o=[]; for(let i=1;i<=h;i++) if(!L.items.has(i)) o.push(i); return o; }
const nombre = (L,n) => `${L.ts}-${L.hash}-${n}.${L.ext}`;
const urlDe = (L,n) => (cfg.base?cfg.base+'/':'')+nombre(L,n);
function resumenLote(L){
  const items=[...L.items.values()];
  return { n:items.length, traidas:items.filter(i=>i.origen==='traida').length, bytes:items.reduce((a,i)=>a+i.bytes,0), fav:items.filter(i=>i.favorita).length, faltan:faltantes(L).length, hasta:rangoEsperado(L) };
}

// ---------- INICIO
function renderInicio(){
  let fotos=0, bytes=0, fav=0, traidas=0, completos=0;
  const rows=[];
  for(const [key,L] of lotes){
    const r=resumenLote(L); fotos+=r.n; bytes+=r.bytes; fav+=r.fav; traidas+=r.traidas; if(!r.faltan) completos++;
    rows.push(`<tr><td class="k"><a href="#galerias">${esc(key)}</a></td><td>${r.n-r.traidas}</td><td>${r.traidas}</td><td>${r.faltan}</td><td>${fmt(r.bytes)}</td><td><span class="pill ${r.faltan?'miss':'ok'}">${r.faltan?'faltan '+r.faltan:'completo'}</span></td></tr>`);
  }
  $('dFotos').textContent=fotos; $('dFotosSub').textContent=`${lotes.size} lotes · ${traidas} traídas`;
  $('dEspacio').textContent=fmt(bytes); $('dEspacioSub').textContent=`${(bytes/1073741824).toFixed(3)} GB en el bucket`;
  const gb=bytes/1073741824, cobrable=Math.max(0, gb-cfg.gbInc), costo=cobrable*cfg.tarifa;
  $('dCosto').textContent = cfg.tarifa ? `US$${costo.toFixed(costo<1?3:2)}` : '—';
  $('dCostoSub').textContent = cfg.tarifa ? `${cobrable.toFixed(3)} GB sobre ${cfg.gbInc} GB incluidos × US$${cfg.tarifa}/GB` : 'configura la tarifa en Admin';
  $('dFav').textContent=fav; $('dFavSub').textContent=`${completos} de ${lotes.size} lotes completos`;
  $('dLotes').innerHTML = rows.join('') || '<tr><td colspan="6" class="note">Aún no hay lotes. Sube fotos en "Carga fotos".</td></tr>';
}

// ---------- GALERÍAS
$('galFiltro').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; galFiltro=b.dataset.f; document.querySelectorAll('#galFiltro button').forEach(x=>x.classList.toggle('on',x===b)); renderGalerias(); });
function renderGalerias(){
  let total=0, fav=0; const parts=[];
  for(const [key,L] of lotes){
    const r=resumenLote(L); total+=r.n; fav+=r.fav;
    if(galFiltro==='incompletos' && !r.faltan) continue;
    const cards=[];
    for(let i=1;i<=r.hasta;i++){
      const it=L.items.get(i);
      if(it){
        if(galFiltro==='fav' && !it.favorita) continue;
        cards.push(`<figure class="gc" data-id="${it.id}"><img loading="lazy" src="${esc(it.url)}" alt="${esc(nombre(L,i))}"><button class="fav ${it.favorita?'on':''}" title="Favorita" data-id="${it.id}">${it.favorita?'★':'☆'}</button><figcaption><b>${i}</b><span class="pill ${it.origen==='traida'?'ok':'warn'}">${it.origen}</span><a href="${esc(it.url)}" target="_blank" rel="noopener">abrir</a></figcaption></figure>`);
      } else if(galFiltro!=='fav') cards.push(`<figure class="gc"><div class="cell miss" style="aspect-ratio:1;border:0;border-radius:0">${i}</div><figcaption><b>${i}</b><span class="pill miss">falta</span></figcaption></figure>`);
    }
    if(!cards.length) continue;
    parts.push(`<section class="panel" style="margin-bottom:16px"><h2 class="key" style="text-transform:none;letter-spacing:0">${esc(key)} · ${r.n} de ${r.hasta}${r.fav?' · ★ '+r.fav:''}</h2><div class="gal">${cards.join('')}</div></section>`);
  }
  $('galBody').innerHTML = parts.join('') || '<p class="note">Nada que mostrar con este filtro.</p>';
  $('galStats').textContent = `${total} imágenes · ${fav} favoritas · ${lotes.size} lotes`;
}
$('galBody').addEventListener('click', async e=>{
  const b=e.target.closest('button.fav'); if(!b) return;
  const id=Number(b.dataset.id); let it; for(const L of lotes.values()) for(const x of L.items.values()) if(x.id===id) it=x;
  if(!it) return;
  const nuevo=!it.favorita;
  const { error } = await sb.from('arkaphoto_imagenes').update({ favorita: nuevo }).eq('id', id);
  if(error){ toast('No se guardó: '+error.message); return; }
  it.favorita=nuevo; b.classList.toggle('on',nuevo); b.textContent=nuevo?'★':'☆';
});

// ---------- CARGA FOTOS: local → resolver (n) → subir
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
  await subir(resolverDuplicados());
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
    d.innerHTML = `<div class="lote-head"><span class="key">${esc(key)}</span><span class="pill ${miss.length?'miss':'ok'}">${miss.length?miss.length+' faltantes':'completo'}</span><span class="pill warn">${L.items.size} de ${hasta}</span></div>`;
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
  if(!cfg.base){ toast('Configura la ruta pública en Admin'); }
  const ul=$('missList'); ul.replaceChildren();
  lastMissing.forEach(({L,n})=>{ const li=document.createElement('li'); const u=urlDe(L,n);
    li.innerHTML=`<span class="n">${n}</span>`+(cfg.base?`<a href="${esc(u)}" target="_blank" rel="noopener">${esc(u)}</a>`:`<span>${esc(nombre(L,n))}</span>`); ul.appendChild(li); });
  $('traerTxt').textContent=''; $('faltantes').hidden=false; $('pregunta').hidden=true;
  $('faltantes').scrollIntoView({behavior:'smooth',block:'start'});
});
$('btnNo').addEventListener('click',()=>{ $('pregunta').hidden=true; });
$('btnCopiar').addEventListener('click',()=>{ navigator.clipboard?.writeText(lastMissing.map(({L,n})=>urlDe(L,n)).join('\n')).then(()=>toast('Lista copiada')).catch(()=>toast('No se pudo copiar')); });
$('btnTraer').addEventListener('click', async ()=>{
  if(!cfg.base){ toast('Configura la ruta pública en Admin'); return; }
  $('btnTraer').disabled=true;
  const porLote = new Map();
  lastMissing.forEach(({key,L,n})=>{ if(!porLote.has(key)) porLote.set(key,{ext:L.ext,seqs:[]}); porLote.get(key).seqs.push(n); });
  let ok=0, no=0; const fallas=[];
  for(const [lote,{ext,seqs}] of porLote){
    $('traerTxt').textContent=`Trayendo ${seqs.length} del lote ${lote}…`;
    const r = await post('/api/traer',{lote,ext,seqs},true);
    if(!r.ok){ fallas.push(`${lote}: ${r.j.error||r.status}`); continue; }
    r.j.resultados.forEach(x=>{ if(x.ok) ok++; else { no++; fallas.push(`${x.nombre}: ${describeFalla(x)}`); } });
  }
  await cargarImagenes(); render();
  $('faltantes').hidden=false; $('pregunta').hidden=true;
  $('traerTxt').textContent = `Traídas: ${ok}. No encontradas o con error: ${no}.` + (fallas.length?`\n${fallas.join('\n')}`:'');
  $('btnTraer').disabled=false;
});
const describeFalla = x => x.status==='existe'?'ya existe en el sistema':x.status==='omitida'?`omitida (${x.error})`:x.status===404?'no existe en la ruta':`HTTP ${x.status}${x.error?' '+x.error:''}`;

// ---------- CARGA DE URL
let urlsNuevas = [];
$('btnAnalizar').addEventListener('click', ()=>{
  const lineas=[...new Set($('urlsTxt').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean))];
  const filas=[]; urlsNuevas=[]; const vistos=new Set();
  lineas.forEach((u,i)=>{
    let nombreArch='', lote='', seq='', estado='', ok=false;
    try{
      const url=new URL(u); nombreArch=decodeURIComponent(url.pathname.split('/').pop()||'');
      const m=nombreArch.match(RX);
      if(url.protocol!=='https:') estado='solo https';
      else if(!m) estado='nombre no reconocido';
      else {
        lote=`${m[1]}-${m[2].toLowerCase()}`; seq=parseInt(m[3],10);
        const k=`${lote}-${seq}`;
        if(seq<1||seq>32) estado='secuencia fuera de 1–32';
        else if(lotes.get(lote)?.items.has(seq)) estado='ya existe en el sistema';
        else if(vistos.has(k)) estado='repetida en la lista';
        else { estado='nueva'; ok=true; vistos.add(k); urlsNuevas.push(u); }
      }
    }catch{ estado='URL inválida'; }
    filas.push(`<tr><td>${i+1}</td><td class="k">${esc(nombreArch||u)}</td><td class="k">${esc(lote)}</td><td>${esc(seq)}</td><td><span class="pill ${ok?'ok':estado.startsWith('ya')?'warn':'miss'}">${esc(estado)}</span></td></tr>`);
  });
  $('urlsBody').innerHTML=filas.join(''); $('urlsTabla').hidden=!filas.length;
  $('urlsResumen').textContent=`${lineas.length} URLs · ${urlsNuevas.length} nuevas`;
  $('btnTraerUrls').disabled=!urlsNuevas.length;
});
$('btnTraerUrls').addEventListener('click', async ()=>{
  $('btnTraerUrls').disabled=true; $('urlsResumen').textContent=`Trayendo ${urlsNuevas.length}…`;
  const r = await post('/api/traer',{urls:urlsNuevas},true);
  if(!r.ok){ $('urlsResumen').textContent='Error: '+(r.j.error||r.status); $('btnTraerUrls').disabled=false; return; }
  const porUrl=new Map(r.j.resultados.map(x=>[x.url,x]));
  document.querySelectorAll('#urlsBody tr').forEach(tr=>{
    const u=[...tr.querySelectorAll('td')][1]; const x=[...porUrl.values()].find(x=>u.textContent===decodeURIComponent(new URL(x.url).pathname.split('/').pop()||''));
    if(!x) return; const pill=tr.querySelector('.pill');
    pill.className='pill '+(x.ok?'ok':'miss'); pill.textContent = x.ok?`traída (${fmt(x.bytes)})`:describeFalla(x);
  });
  $('urlsResumen').textContent=`Traídas: ${r.j.traidas} de ${urlsNuevas.length}`;
  await cargarImagenes(); urlsNuevas=[];
});

// ---------- ADMIN
async function renderMigraciones(){
  const { data, error } = await sb.from('arkaphoto_migraciones').select('num,nombre,version,aplicada_en').order('num');
  $('migBody').innerHTML = error ? `<tr><td colspan="4" class="err">${esc(error.message)}</td></tr>` :
    (data||[]).map(m=>`<tr><td>${m.num}</td><td class="k">${esc(m.nombre)}</td><td>${esc(m.version||'')}</td><td>${new Date(m.aplicada_en).toLocaleString('es-MX')}</td></tr>`).join('');
}
$('btnSistema').addEventListener('click', async ()=>{
  const out=[]; const fila=(n,estado,txt)=>out.push(`<div class="r"><span class="n">${n}</span><span><span class="dot ${estado}"></span>${esc(txt)}</span></div>`);
  $('sysBody').innerHTML='<div class="r"><span class="n">Verificando…</span></div>';
  try{ const t=await fetch('index.html',{cache:'no-store'}).then(r=>r.text()); const m=t.match(/<!-- ARKAPHOTO v([\d.]+) -->/); const v=m?.[1];
    fila('index.html', v===CFG.VERSION?'ok':v?'warn':'bad', v?`servido v${v} · esperado v${CFG.VERSION}`:'sin comentario de versión'); }catch(e){ fila('index.html','bad','no se pudo leer'); }
  try{ const r=await fetch('/api/version',{cache:'no-store'}); const j=await r.json(); const h=r.headers.get('x-app-version');
    fila('/api/version', j.version===CFG.VERSION?'ok':'warn', `backend v${j.version} (header ${h||'—'}) · frontend v${CFG.VERSION}`);
    fila('migración', j.migracion_aplicada===CFG.MIGRACION_ESPERADA?'ok':j.migracion_aplicada>CFG.MIGRACION_ESPERADA?'warn':'bad', `aplicada ${j.migracion_aplicada ?? '?'} · esperada ${CFG.MIGRACION_ESPERADA}`);
  }catch(e){ fila('/api/version','bad','sin respuesta: '+e.message); }
  for(const ep of ['/api/config','/api/auth/send','/api/auth/verify','/api/traer']){
    try{ const r=await fetch(ep,{method:ep==='/api/config'?'GET':'POST',headers:{'Content-Type':'application/json'},body:ep==='/api/config'?undefined:'{}'}); const h=r.headers.get('x-app-version');
      fila(ep, h===CFG.VERSION?'ok':h?'warn':'bad', h?`v${h}`:'sin x-app-version'); }catch(e){ fila(ep,'bad','sin respuesta'); }
  }
  const { count } = await sb.from('arkaphoto_imagenes').select('id',{count:'exact',head:true});
  fila('imágenes', 'ok', `${count} filas en arkaphoto_imagenes`);
  $('sysBody').innerHTML=out.join('');
});
$('btnValidar').addEventListener('click', async ()=>{
  $('valResumen').textContent='Comparando…'; const ul=$('valList'); ul.replaceChildren();
  let sinObjeto=0, huerfanos=0, ok=0;
  for(const [key,L] of lotes){
    const { data, error } = await sb.storage.from(BUCKET).list(`${session.user.id}/${key}`,{limit:200});
    if(error){ ul.insertAdjacentHTML('beforeend',`<li><span class="n">!</span><span>${esc(key)}</span><span class="note">${esc(error.message)}</span></li>`); continue; }
    const enBucket=new Set((data||[]).map(o=>o.name));
    for(const [seq,it] of L.items){ const n=nombre(L,seq); if(enBucket.has(n)){ ok++; enBucket.delete(n);} else { sinObjeto++; ul.insertAdjacentHTML('beforeend',`<li><span class="n">!</span><span>${esc(n)}</span><span class="note">registrada pero sin archivo en el bucket</span></li>`);} }
    for(const n of enBucket){ huerfanos++; ul.insertAdjacentHTML('beforeend',`<li><span class="n">!</span><span>${esc(key+'/'+n)}</span><span class="note">archivo en el bucket sin registro</span></li>`); }
  }
  $('valResumen').textContent=`${ok} coinciden · ${sinObjeto} registradas sin archivo · ${huerfanos} archivos sin registro`;
});

route();
