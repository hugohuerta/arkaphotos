import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

const CFG = { VERSION: '0.18.0', MIGRACION_ESPERADA: 13, URL_TTL: 3600 };
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
const cfg = { base:'', tarifa:0.021, gbInc:1 };
const lotes = new Map();   // key -> {ts,hash,ext,items:Map(seq->{id,url,origen,bytes,favorita,ruta})}
const raw = new Map();     // archivos locales pendientes de subir (nombre -> File)
const bad = []; let dupes = [], lastMissing = [], galFiltro = 'todos';
const fil = { tipo:'', sub:'', det:'', q:'', tag:null, fmt:'' };
let galVista = '1x'; const colapsados = new Set(); let editando = null;
const sesionLotes = new Set(); const selHist = new Set(); const selCarga = new Set(); let cargaTab = 'cargar', histFiltro = 'todos';
try{ galVista = localStorage.getItem('arkaphoto-vista')||'1x'; JSON.parse(localStorage.getItem('arkaphoto-colapsados')||'[]').forEach(k=>colapsados.add(k)); }catch{}
const guardaColapsados = ()=>{ try{ localStorage.setItem('arkaphoto-colapsados', JSON.stringify([...colapsados])); }catch{} };
const tags = new Map();        // id -> {id,nombre}
const loteTags = new Map();    // lote -> Set(tag_id)
const clasif = new Map();  // id -> {id,parent_id,nivel,nombre,orden}
const lotesMeta = new Map(); // lote -> {nombre,clasif_id,notas}
let clSel = { 1:null, 2:null };  // selección en el árbol de Admin

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
  if(v==='galerias'){ renderGalerias(true); }
  if(v==='carga') mostrarCargaTab(cargaTab);
  if(v==='admin') { renderArbol(); renderAdminTags(); mostrarTab(adminTab); }
  if(v==='urls') colaEstado();
}
window.addEventListener('hashchange', route);
sb.auth.onAuthStateChange((ev, ses)=>{ if(ses) session=ses; if(ev==='SIGNED_OUT') show('vLogin'); });

// ---------- login: código de 8 dígitos por Resend (/api/auth/*), sesión Supabase vía token_hash
let emailPend = '', cooldownT = null;
// Token fresco en cada llamada: supabase-js lo renueva cada hora y el guardado al entrar caduca
async function tokenActual(){ const { data } = await sb.auth.getSession(); if(data.session) session=data.session; return data.session?.access_token||''; }
const post = async (url, body, auth=false) => fetch(url,{ method:'POST', headers:{'Content-Type':'application/json', ...(auth?{Authorization:`Bearer ${await tokenActual()}`}:{})}, body:JSON.stringify(body) }).then(async r=>({ ok:r.ok, status:r.status, j: await r.json().catch(()=>({})) }));

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
// Ancho completo (monitores grandes); se recuerda por navegador
function aplicarAncho(on){ document.documentElement.classList.toggle('ancho', on); $('btnAncho').textContent = on ? '⟷ Normal' : '⟷ Ancho'; try{ localStorage.setItem('arkaphoto-ancho', on?'1':'0'); }catch{} }
try{ aplicarAncho(localStorage.getItem('arkaphoto-ancho')==='1'); }catch{}
$('btnAncho').addEventListener('click', ()=>aplicarAncho(!document.documentElement.classList.contains('ancho')));
$('btnSalir').addEventListener('click', async ()=>{ await sb.auth.signOut(); lotes.clear(); show('vLogin'); });

// ---------- datos
// PostgREST devuelve máximo 1000 filas por consulta: se pagina siempre
async function todas(construir, tam=1000){
  const out=[]; for(let desde=0;;desde+=tam){ const { data, error } = await construir().range(desde, desde+tam-1); if(error) throw error; out.push(...(data||[])); if(!data||data.length<tam) break; } return out;
}
async function cargarTodo(){
  const { data: c } = await sb.from('arkaphoto_config').select('ruta_publica,tarifa_gb_usd,gb_incluidos').maybeSingle();
  cfg.base = (c?.ruta_publica||'').replace(/\/+$/,'');
  cfg.tarifa = Number(c?.tarifa_gb_usd ?? 0.021); cfg.gbInc = Number(c?.gb_incluidos ?? 1);
  $('baseUrl').value = cfg.base; $('tarifa').value = cfg.tarifa; $('gbInc').value = cfg.gbInc;
  await Promise.all([cargarClasif(), cargarLotesMeta(), cargarTags(), cargarImagenes()]);
}
async function cargarTags(){
  let t, lt; try{ [t, lt] = await Promise.all([ todas(()=>sb.from('arkaphoto_tags').select('id,nombre').order('nombre')), todas(()=>sb.from('arkaphoto_lote_tags').select('lote,tag_id').order('lote')) ]); }catch(e){ toast('Error leyendo tags'); return; }
  tags.clear(); t.forEach(x=>tags.set(x.id,x));
  loteTags.clear(); lt.forEach(x=>{ if(!loteTags.has(x.lote)) loteTags.set(x.lote,new Set()); loteTags.get(x.lote).add(x.tag_id); });
}
const tagsDe = key => [...(loteTags.get(key)||[])].map(id=>tags.get(id)).filter(Boolean).sort((a,b)=>a.nombre.localeCompare(b.nombre));
async function tagPorNombre(nombre){
  nombre=nombre.trim().replace(/\s+/g,' '); if(!nombre) return null;
  const ex=[...tags.values()].find(t=>t.nombre.toLowerCase()===nombre.toLowerCase()); if(ex) return ex;
  const { data, error } = await sb.from('arkaphoto_tags').insert({ user_id:session.user.id, nombre }).select().single();
  if(error){ toast('No se creó el tag: '+error.message); return null; }
  tags.set(data.id,data); return data;
}
async function cargarClasif(){
  const { data, error } = await sb.from('arkaphoto_clasif').select('id,parent_id,nivel,nombre,orden').order('nivel').order('orden').order('nombre');
  if(error){ toast('Error leyendo clasificación: '+error.message); return; }
  clasif.clear(); (data||[]).forEach(c=>clasif.set(c.id,c));
  cascCarga.pinta(); cascMasivo.pinta(); cascUrls.pinta();
  const sel=$('fTipo'); sel.innerHTML='<option value="">Todos los tipos</option>'+hijos(null).map(t=>`<option value="${t.id}">${esc(t.nombre)}</option>`).join(''); sel.value=fil.tipo;
}
async function cargarLotesMeta(){
  let data; try{ data = await todas(()=>sb.from('arkaphoto_lotes').select('lote,nombre,clasif_id,notas,portada_seq,tamano,sondeado_en').order('lote')); }catch(e){ toast('Error leyendo lotes: '+e.message); return; }
  lotesMeta.clear(); data.forEach(m=>lotesMeta.set(m.lote,m));
}
const hijos = pid => [...clasif.values()].filter(c=>(c.parent_id??null)===(pid??null)).sort((a,b)=>a.orden-b.orden||a.nombre.localeCompare(b.nombre));
function rutaClasif(id){ const out=[]; let c=clasif.get(id); while(c){ out.unshift(c); c=clasif.get(c.parent_id); } return out; }
const tipoDe = id => rutaClasif(id)[0]?.id ?? null;
// Tres selects en cascada; devuelve {valor(), reset(), pinta()}
function cascada(idT, idS, idD){
  const T=$(idT), S=$(idS), D=$(idD);
  const opts=(list,vacio='—')=>`<option value="">${vacio}</option>`+list.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('');
  const pinta=()=>{ const t=T.value; T.innerHTML=opts(hijos(null)); T.value=t; const sv=S.value; S.innerHTML=opts(T.value?hijos(Number(T.value)):[]); S.value=sv; const dv=D.value; D.innerHTML=opts(S.value?hijos(Number(S.value)):[]); D.value=dv; };
  T.addEventListener('change',()=>{ S.value=''; D.value=''; pinta(); }); S.addEventListener('change',()=>{ D.value=''; pinta(); });
  return { pinta, valor:()=>Number(D.value||S.value||T.value)||null, reset:()=>{ T.value=''; S.value=''; D.value=''; pinta(); } };
}
const cascCarga = cascada('cTipo','cSub','cDet'), cascMasivo = cascada('mTipo','mSub','mDet'), cascUrls = cascada('uTipo','uSub','uDet');
async function clasificarLotes(keys, clasif_id){
  let n=0;
  for(const key of keys){
    const meta=lotesMeta.get(key)||{}; const row={ ...meta, user_id:session.user.id, lote:key, clasif_id, actualizado:new Date().toISOString() };
    const { error } = await sb.from('arkaphoto_lotes').upsert(row); if(error){ toast(`${etiqueta(key)}: ${error.message}`); continue; }
    lotesMeta.set(key,row); n++;
  }
  return n;
}

const fechaLote = key => { const t=Number(key.split('-')[0]); return t>1e11 ? new Date(t) : new Date(t*1000); };
const fmtFecha = d => d.toLocaleDateString('es-MX',{ year:'numeric', month:'short', day:'2-digit' });
const dfil = { desde:'', hasta:'', sub:'', q:'' };
// Etiqueta visible: LOTE <ts> (con -A/-B si el timestamp se repite); con nombre: NOMBRE <ts>-A
function etiqueta(key){
  const ts=key.split('-')[0];
  const iguales=[...lotes.keys()].filter(k=>k.split('-')[0]===ts).sort();
  const letra = iguales.length>1 ? '-'+String.fromCharCode(65+iguales.indexOf(key)) : '';
  const meta=lotesMeta.get(key)||{}; const ruta=rutaClasif(meta.clasif_id);
  const partes=[];
  if(ruta[1]) { partes.push(ruta[1].nombre); if(ruta[2]) partes.push(ruta[2].nombre); }
  else if((meta.nombre||'').trim()) partes.push(meta.nombre.trim());
  else partes.push('LOTE');
  return partes.map(x=>x.toUpperCase()).join(' - ')+' - '+ts+letra;
}
async function firmar(rutas){
  if(!rutas.length) return new Map();
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrls(rutas, CFG.URL_TTL);
  if(error){ toast('No se pudieron firmar las URLs: '+error.message); return new Map(); }
  return new Map(data.map(d=>[d.path, d.signedUrl]));
}
const urlCache = new Map(); // ruta -> {url, exp}
async function cargarImagenes(){
  let data; try{ data = await todas(()=>sb.from('arkaphoto_imagenes').select('id,lote,seq,ext,ruta,bytes,origen,favorita,oculta,ancho,alto').order('lote').order('seq')); }
  catch(e){ toast('Error leyendo imágenes: '+e.message); return; }
  lotes.clear();
  for(const r of data){
    const [ts,hash] = r.lote.split('-');
    if(!lotes.has(r.lote)) lotes.set(r.lote,{ts,hash,ext:r.ext,items:new Map()});
    const c=urlCache.get(r.ruta); const url = c && c.exp>Date.now() ? c.url : '';
    lotes.get(r.lote).items.set(r.seq,{id:r.id,url,origen:r.origen,bytes:r.bytes||0,favorita:!!r.favorita,oculta:!!r.oculta,ruta:r.ruta,ancho:r.ancho,alto:r.alto});
  }
}
// Firma solo las imágenes que se van a mostrar (por lotes), con caché hasta 5 min antes de caducar
async function asegurarUrls(keys){
  const rutas=[]; const items=[];
  for(const k of keys){ const L=lotes.get(k); if(!L) continue; for(const it of L.items.values()){ if(!it.url){ rutas.push(it.ruta); items.push(it); } } }
  if(!rutas.length) return false;
  for(let i=0;i<rutas.length;i+=500){ const m=await firmar(rutas.slice(i,i+500)); for(const it of items.slice(i,i+500)){ const u=m.get(it.ruta); if(u){ it.url=u; urlCache.set(it.ruta,{url:u,exp:Date.now()+(CFG.URL_TTL-300)*1000}); } } }
  return true;
}
// Pone src a las imágenes del DOM que esperan URL (data-ruta) tras firmar
async function hidratarImgs(cont){
  const keys=[...new Set([...cont.querySelectorAll('[data-lote]')].map(e=>e.dataset.lote))];
  if(!(await asegurarUrls(keys))) return;
  const porRuta=new Map(); for(const k of keys){ const L=lotes.get(k); if(L) for(const it of L.items.values()) porRuta.set(it.ruta,it); }
  cont.querySelectorAll('img[data-ruta]').forEach(im=>{ const it=porRuta.get(im.dataset.ruta); if(it?.url){ im.src=it.url; im.removeAttribute('data-ruta'); } });
  if(vistaActual()==='galerias') completarDimensiones();
}
$('fCfg').addEventListener('submit', async e=>{
  e.preventDefault();
  cfg.base = $('baseUrl').value.trim().replace(/\/+$/,'');
  cfg.tarifa = parseFloat($('tarifa').value)||0; cfg.gbInc = parseFloat($('gbInc').value)||0;
  const { error } = await sb.from('arkaphoto_config').upsert({ user_id: session.user.id, ruta_publica: cfg.base, tarifa_gb_usd: cfg.tarifa, gb_incluidos: cfg.gbInc, actualizado: new Date().toISOString() });
  toast(error ? 'No se guardó: '+error.message : 'Configuración guardada');
});

// ---------- lógica de lotes
// Formato por proporción: la más cercana entre 1:1, 16:9, 9:16, 4:3, 3:4 (tolerancia 6 %); si no, "otro"; sin medidas, "?"
const FORMATOS = [['1:1',1],['16:9',16/9],['9:16',9/16],['4:3',4/3],['3:4',3/4]];
function formatoDe(it){ if(!it.ancho||!it.alto) return '?'; const r=it.ancho/it.alto; let mejor='otro', d=0.06; for(const [n,v] of FORMATOS){ const dd=Math.abs(r-v)/v; if(dd<d){ d=dd; mejor=n; } } return mejor; }
const medir = url => new Promise(res=>{ const im=new Image(); im.onload=()=>res({ancho:im.naturalWidth,alto:im.naturalHeight}); im.onerror=()=>res(null); im.src=url; });
let midiendo=false;
async function completarDimensiones(max=40){
  if(midiendo) return; midiendo=true; let n=0;
  try{ for(const L of lotes.values()) for(const it of L.items.values()){ if(it.ancho||n>=max) continue; if(!it.url) continue; const d=await medir(it.url); if(!d) continue; const { error } = await sb.from('arkaphoto_imagenes').update(d).eq('id',it.id); if(!error){ Object.assign(it,d); n++; } } }
  finally{ midiendo=false; }
  if(n){ toast(`${n} fotos medidas`); if(vistaActual()==='galerias') renderGalerias(); }
  return n;
}
const barra = (n, hasta, sond=true) => { const pct=hasta?Math.round(100*n/hasta):0; return `<span class="prog ${pct>=100?'full':''}" title="${sond?'tamaño sondeado en la ruta pública':'tamaño asumido por lo subido (sin sondear)'}"><i style="width:${pct}%"></i><b>${n} de ${hasta}${sond?'':' ?'}<small>${pct}%</small></b></span>`; };
const pow2 = n => { let p=1; while(p<n) p*=2; return Math.min(MAX,p); };
function rangoEsperado(L, key){
  const max = Math.max(1, ...L.items.keys()); const minimo = pow2(max);
  const t = key ? (lotesMeta.get(key)||{}).tamano : null;
  return t && t>=minimo ? t : minimo;
}
async function sondear(keys, forzar=false){
  const lista = keys.filter(k=>lotes.has(k) && (forzar || !(lotesMeta.get(k)||{}).tamano)).map(k=>{ const L=lotes.get(k); return { lote:k, ext:L.ext, minimo: pow2(Math.max(1,...L.items.keys())) }; });
  if(!lista.length) return 0;
  if(!cfg.base){ toast('Sin ruta pública: se asume el tamaño por lo subido'); return 0; }
  const r = await post('/api/sondear',{ lotes:lista },true);
  if(!r.ok){ toast('Sondeo: '+(r.j.error||r.status)); return 0; }
  await cargarLotesMeta(); return r.j.resultados.filter(x=>x.tamano).length;
}
function faltantes(L,key){ const h=rangoEsperado(L,key), o=[]; for(let i=1;i<=h;i++) if(!L.items.has(i)) o.push(i); return o; }
const nombre = (L,n) => `${L.ts}-${L.hash}-${n}.${L.ext}`;
const urlDe = (L,n) => (cfg.base?cfg.base+'/':'')+nombre(L,n);
function resumenLote(L,key){
  const items=[...L.items.values()];
  return { n:items.length, traidas:items.filter(i=>i.origen==='traida').length, bytes:items.reduce((a,i)=>a+i.bytes,0), fav:items.filter(i=>i.favorita).length, ocultas:items.filter(i=>i.oculta).length, faltan:faltantes(L,key).length, hasta:rangoEsperado(L,key) };
}

// ---------- INICIO
function renderInicio(){
  let fotos=0, bytes=0, fav=0, traidas=0, completos=0, ocultas=0;
  // selector de subgrupo (nivel 2, agrupado por tipo)
  const sel=$('dSub'); const cur=dfil.sub;
  sel.innerHTML='<option value="">Todos</option>'+hijos(null).map(t=>{ const subs=hijos(t.id); return subs.length?`<optgroup label="${esc(t.nombre)}">${subs.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join('')}</optgroup>`:''; }).join('');
  sel.value=cur;
  const rows=[]; let mostrados=0;
  const orden=[...lotes.entries()].sort((a,b)=>fechaLote(b[0])-fechaLote(a[0]));
  for(const [key,L] of orden){
    const r=resumenLote(L,key); fotos+=r.n; bytes+=r.bytes; fav+=r.fav; traidas+=r.traidas; ocultas+=r.ocultas; if(!r.faltan) completos++;
    const meta=lotesMeta.get(key)||{}; const ruta=rutaClasif(meta.clasif_id); const f=fechaLote(key);
    if(dfil.desde && f < new Date(dfil.desde+'T00:00:00')) continue;
    if(dfil.hasta && f > new Date(dfil.hasta+'T23:59:59')) continue;
    if(dfil.sub && String(ruta[1]?.id)!==dfil.sub) continue;
    if(dfil.q){ const texto=[etiqueta(key), key, meta.nombre, meta.notas, ...ruta.map(c=>c.nombre), ...tagsDe(key).map(t=>t.nombre)].filter(Boolean).join(' ').toLowerCase(); if(!texto.includes(dfil.q)) continue; }
    mostrados++; if(rows.length>=100) continue;
    const rutaTxt=ruta.map(c=>esc(c.nombre)).join(' › ');
    rows.push(`<tr><td style="white-space:nowrap">${fmtFecha(f)}</td><td><a href="#galerias" class="etq" style="font-size:.9rem" title="${esc(key)}">${esc(etiqueta(key))}</a></td><td class="ruta">${rutaTxt||'<span class="pill warn">sin clasificar</span>'}</td><td>${r.n-r.traidas}</td><td>${r.traidas}</td><td>${r.faltan}</td><td>${fmt(r.bytes)}</td><td><span class="pill ${r.faltan?'miss':'ok'}">${r.faltan?'faltan '+r.faltan:'completo'}</span></td></tr>`);
  }
  $('dFotos').textContent=fotos; $('dFotosSub').textContent=`${lotes.size} lotes · ${traidas} traídas${ocultas?` · ${ocultas} ocultas`:''}`;
  $('dEspacio').textContent=fmt(bytes); $('dEspacioSub').textContent=`${(bytes/1073741824).toFixed(3)} GB en el bucket`;
  const gb=bytes/1073741824, cobrable=Math.max(0, gb-cfg.gbInc), costo=cobrable*cfg.tarifa;
  $('dCosto').textContent = cfg.tarifa ? `US$${costo.toFixed(costo<1?3:2)}` : '—';
  $('dCostoSub').textContent = cfg.tarifa ? `${cobrable.toFixed(3)} GB sobre ${cfg.gbInc} GB incluidos × US$${cfg.tarifa}/GB` : 'configura la tarifa en Admin';
  $('dFav').textContent=fav; $('dFavSub').textContent=`${completos} de ${lotes.size} lotes completos`;
  // Análisis por tipo y subgrupo (fotos, espacio, favoritas, lotes); sin clasificar al final
  const agg=new Map(); const nodo=(k,nombre,tipoId,subId)=>{ if(!agg.has(k)) agg.set(k,{nombre,tipoId,subId,lotes:0,fotos:0,bytes:0,fav:0}); return agg.get(k); };
  for(const [key,L] of lotes){
    const r=resumenLote(L,key); const ruta=rutaClasif((lotesMeta.get(key)||{}).clasif_id);
    const tipoId=ruta[0]?.id??0, subId=ruta[1]?.id??0;
    const t=nodo(`t${tipoId}`, ruta[0]?.nombre||'Sin clasificar', tipoId, null); t.lotes++; t.fotos+=r.n; t.bytes+=r.bytes; t.fav+=r.fav;
    const sNombre = ruta[1]?.nombre || (tipoId?'(sin subgrupo)':'');
    if(sNombre){ const sN=nodo(`t${tipoId}s${subId}`, sNombre, tipoId, subId); sN.lotes++; sN.fotos+=r.n; sN.bytes+=r.bytes; sN.fav+=r.fav; }
  }
  const tipos=[...agg.values()].filter(x=>x.subId===null).sort((a,b)=>(a.tipoId===0)-(b.tipoId===0)||b.fotos-a.fotos);
  const maxFotos=Math.max(1,...tipos.map(t=>t.fotos)); const html=[];
  for(const t of tipos){
    const pct=fotos?Math.round(100*t.fotos/fotos):0;
    html.push(`<tr class="tipo"><td>${esc(t.nombre)}</td><td></td><td>${t.lotes}</td><td><span class="mini" style="width:${Math.round(80*t.fotos/maxFotos)}px"></span>${t.fotos}</td><td>${pct}%</td><td>${fmt(t.bytes)}</td><td>${t.fav||''}</td><td>${t.tipoId?`<a href="#galerias" data-tipo="${t.tipoId}" class="verGal">ver</a>`:'<a href="#galerias" data-filtro="sinclasif" class="verGal">ver</a>'}</td></tr>`);
    const subs=[...agg.values()].filter(x=>x.tipoId===t.tipoId && x.subId!==null).sort((a,b)=>b.fotos-a.fotos);
    for(const sN of subs){ const sp=t.fotos?Math.round(100*sN.fotos/t.fotos):0;
      html.push(`<tr class="sub"><td>·</td><td>${esc(sN.nombre)}</td><td>${sN.lotes}</td><td>${sN.fotos}</td><td>${sp}% del tipo</td><td>${fmt(sN.bytes)}</td><td>${sN.fav||''}</td><td>${sN.subId?`<a href="#galerias" data-tipo="${t.tipoId}" data-sub="${sN.subId}" class="verGal">ver</a>`:''}</td></tr>`); }
  }
  $('dClas').innerHTML = html.join('') || '<tr><td colspan="8" class="note">Sin lotes.</td></tr>';
  $('dClasN').textContent = `${fotos} fotos · ${fmt(bytes)} · ${tipos.filter(t=>t.tipoId).length} tipos`;

  $('dLotes').innerHTML = rows.join('') || `<tr><td colspan="8" class="note">${lotes.size?'Ningún lote cumple el filtro.':'Aún no hay lotes. Sube fotos en "Carga fotos".'}</td></tr>`;
  $('dLotesN').textContent = `${mostrados} de ${lotes.size}${mostrados>100?' · se muestran los 100 más recientes':''}`;
}

$('dClas').addEventListener('click', e=>{ const a=e.target.closest('a.verGal'); if(!a) return;
  fil.tipo=a.dataset.tipo||''; fil.sub=a.dataset.sub||''; fil.det=''; galFiltro=a.dataset.filtro||'todos';
  $('fTipo').value=fil.tipo; document.querySelectorAll('#galFiltro button').forEach(x=>x.classList.toggle('on',x.dataset.f===galFiltro)); });
$('dDesde').addEventListener('change',e=>{ dfil.desde=e.target.value; renderInicio(); });
$('dHasta').addEventListener('change',e=>{ dfil.hasta=e.target.value; renderInicio(); });
$('dSub').addEventListener('change',e=>{ dfil.sub=e.target.value; renderInicio(); });
$('dBuscar').addEventListener('input',e=>{ dfil.q=e.target.value.trim().toLowerCase(); renderInicio(); });
$('dLimpiar').addEventListener('click',()=>{ Object.assign(dfil,{desde:'',hasta:'',sub:'',q:''}); $('dDesde').value=''; $('dHasta').value=''; $('dBuscar').value=''; renderInicio(); });

// ---------- GALERÍAS
$('galFiltro').addEventListener('click', e=>{ const b=e.target.closest('button'); if(!b) return; galFiltro=b.dataset.f; document.querySelectorAll('#galFiltro button').forEach(x=>x.classList.toggle('on',x===b)); renderGalerias(true); });
function pintaCascada(){
  const subs = fil.tipo ? hijos(Number(fil.tipo)) : [];
  $('fSubL').hidden = !fil.tipo; $('fSub').innerHTML='<option value="">Todos</option>'+subs.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join(''); $('fSub').value=fil.sub;
  const dets = fil.sub ? hijos(Number(fil.sub)) : [];
  $('fDetL').hidden = !fil.sub; $('fDet').innerHTML='<option value="">Todos</option>'+dets.map(c=>`<option value="${c.id}">${esc(c.nombre)}</option>`).join(''); $('fDet').value=fil.det;
}
$('fTipo').addEventListener('change', e=>{ fil.tipo=e.target.value; fil.sub=''; fil.det=''; pintaCascada(); renderGalerias(true); });
$('fSub').addEventListener('change', e=>{ fil.sub=e.target.value; fil.det=''; pintaCascada(); renderGalerias(true); });
$('fDet').addEventListener('change', e=>{ fil.det=e.target.value; renderGalerias(true); });
$('fFormato').addEventListener('change', e=>{ fil.fmt=e.target.value; renderGalerias(true); });
$('fBuscar').addEventListener('input', e=>{ fil.q=e.target.value.trim().toLowerCase(); renderGalerias(true); });
$('galVista').addEventListener('click', e=>{ const b=e.target.closest('button[data-v]'); if(!b) return; galVista=b.dataset.v; try{ localStorage.setItem('arkaphoto-vista',galVista); }catch{} renderGalerias(); });
$('btnColapsar').addEventListener('click', ()=>{ const todos=[...lotes.keys()]; const expandir = todos.every(k=>colapsados.has(k)); todos.forEach(k=>expandir?colapsados.delete(k):colapsados.add(k)); guardaColapsados(); renderGalerias(); });
function portadaDe(key, L){ const meta=lotesMeta.get(key)||{}; const vis=[...L.items].filter(([,i])=>!i.oculta); if(!vis.length) return null; if(meta.portada_seq && L.items.get(meta.portada_seq) && !L.items.get(meta.portada_seq).oculta) return meta.portada_seq; const sub=vis.find(([,i])=>i.origen==='subida'); return (sub||vis[0])[0]; }
$('fTags').addEventListener('click', e=>{ const t=e.target.closest('.tag.filtro'); if(!t) return; fil.tag = fil.tag===Number(t.dataset.id)?null:Number(t.dataset.id); renderGalerias(true); });
function pintaTagsFiltro(){
  const usados=new Map(); for(const set of loteTags.values()) for(const id of set) usados.set(id,(usados.get(id)||0)+1);
  $('fTags').innerHTML=[...usados].map(([id,n])=>{ const t=tags.get(id); return t?`<span class="tag filtro ${fil.tag===id?'on':''}" data-id="${id}">${esc(t.nombre)} <small>${n}</small></span>`:''; }).join('');
}
function pasaFiltro(key, L, r, meta){
  if(galFiltro==='incompletos' && !r.faltan) return false;
  if(galFiltro==='sinclasif' && meta.clasif_id) return false;
  if(galFiltro==='ocultas' && !r.ocultas) return false;
  const ruta=rutaClasif(meta.clasif_id);
  if(fil.det){ if(String(ruta[2]?.id)!==fil.det) return false; }
  else if(fil.sub){ if(String(ruta[1]?.id)!==fil.sub) return false; }
  else if(fil.tipo){ if(String(ruta[0]?.id)!==fil.tipo) return false; }
  if(fil.tag && !(loteTags.get(key)||new Set()).has(fil.tag)) return false;
  if(fil.q){
    const texto=[etiqueta(key), key, meta.nombre, meta.notas, ...ruta.map(c=>c.nombre), ...tagsDe(key).map(t=>t.nombre)].filter(Boolean).join(' ').toLowerCase();
    if(!texto.includes(fil.q)) return false;
  }
  return true;
}
const GAL_PAG = 30; let galPag = 1;
function renderGalerias(reset=false){
  if(reset) galPag=1;
  pintaCascada(); pintaTagsFiltro();
  let total=0, fav=0, visibles=0; const parts=[]; const ordenadas=[...lotes.entries()].sort((a,b)=>fechaLote(b[0])-fechaLote(a[0]));
  for(const [key,L] of ordenadas){
    const r=resumenLote(L,key); total+=r.n; fav+=r.fav;
    const meta=lotesMeta.get(key)||{};
    if(!pasaFiltro(key,L,r,meta)) continue;
    const cards=[]; const ed = editando===key; const pseq=portadaDe(key,L);
    for(let i=1;i<=r.hasta;i++){
      const it=L.items.get(i);
      if(it){
        if(galFiltro==='fav' && !it.favorita) continue;
        if(galFiltro==='ocultas' ? !it.oculta : (it.oculta && !ed)) continue;
        if(fil.fmt && formatoDe(it)!==fil.fmt) continue;
        cards.push(`<figure class="gc ${it.oculta?'oc':''} ${pseq===i?'portada':''}" data-id="${it.id}" data-seq="${i}"><img loading="lazy" ${it.url?`src="${esc(it.url)}"`:`data-ruta="${esc(it.ruta)}"`} alt="${esc(nombre(L,i))}" data-seq="${i}">
          <span class="n">${i}</span>
          <div class="ov"><button class="fav ${it.favorita?'on':''}" title="Favorita" data-id="${it.id}">${it.favorita?'★':'☆'}</button><button class="hid ${it.oculta?'on':''}" title="${it.oculta?'Mostrar':'Esconder'}" data-id="${it.id}">✕</button></div>
          <div class="ov bot"><button class="sav" title="Guardar foto" data-seq="${i}">💾</button><button class="opn" title="Abrir en otra pestaña" data-seq="${i}">🔍</button></div>
          ${galVista==='lista'?`<div class="fila"><span class="key">${esc(nombre(L,i))}</span><span>${fmt(it.bytes)}</span><span>${it.ancho?`${it.ancho}×${it.alto} · ${formatoDe(it)}`:'sin medir'}</span><span class="pill ${it.origen==='traida'?'ok':'warn'}">${it.origen}</span>${it.favorita?'<span class="pill ok">★</span>':''}${it.oculta?'<span class="pill miss">oculta</span>':''}</div>`:''}
          ${ed?`<figcaption><b>${i}</b><span class="pill ${it.origen==='traida'?'ok':'warn'}">${it.origen}</span>${pseq===i?'<span class="pill ok">portada</span>':`<button class="quiet mkp" data-seq="${i}" style="padding:2px 6px;font-size:.72rem">portada</button>`}<a href="${esc(it.url)}" target="_blank" rel="noopener">abrir</a></figcaption>`:''}</figure>`);
      } else if(galFiltro!=='fav' && galFiltro!=='ocultas' && !fil.fmt) cards.push(`<figure class="gc"><div class="cell miss" style="aspect-ratio:1;border:0;border-radius:0">${i}</div>${ed?`<figcaption><b>${i}</b><span class="pill miss">falta</span></figcaption>`:''}</figure>`);
    }
    if(!cards.length) continue;
    visibles++;
    if(visibles>galPag*GAL_PAG) continue;
    const tg=tagsDe(key).map(t=>`<span class="tag">${esc(t.nombre)}<button type="button" class="qdel" data-id="${t.id}" title="Quitar tag">✕</button></span>`).join('');
    parts.push(`<section class="panel ${colapsados.has(key)?'col':''}" style="margin-bottom:16px" data-lote="${esc(key)}">
      <div class="ghead">
        <div class="izq"><span class="etq" title="${esc(key)}">${esc(etiqueta(key))}</span>${meta.clasif_id?'':'<span class="pill warn">sin clasificar</span>'}${r.fav?`<span class="pill ok">★ ${r.fav}</span>`:''}<span class="tags">${tg}</span></div>
        <div class="der">${barra(r.n, r.hasta, !!meta.sondeado_en)}${r.ocultas?`<span class="pill warn" title="ocultas">✕ ${r.ocultas}</span>`:''}<button class="tgl pase" data-lote="${esc(key)}" title="Pase de diapositivas">▶ Pase</button><button class="tgl zip" data-lote="${esc(key)}" title="Descargar ZIP">↓ ZIP</button><button class="tgl colap" data-lote="${esc(key)}">${colapsados.has(key)?'Expandir':'Colapsar'}</button><span class="qtag"><button class="qadd" data-lote="${esc(key)}">+ Tag</button></span><button class="ed" data-lote="${esc(key)}">Editar</button></div>
      </div>
      ${pseq?`<div class="cover"><img ${L.items.get(pseq).url?`src="${esc(L.items.get(pseq).url)}"`:`data-ruta="${esc(L.items.get(pseq).ruta)}"`} alt="portada" data-seq="${pseq}"><span class="n">portada · ${pseq}</span></div>`:'<div class="cover note">Sin fotos visibles</div>'}
      <div class="gal ${galVista==='2x'?'x2':galVista==='lista'?'lista':''}">${cards.join('')}</div></section>`);
  }
  const faltanPag = visibles - Math.min(visibles, galPag*GAL_PAG);
  $('galBody').innerHTML = (parts.join('') || '<p class="note">Nada que mostrar con este filtro.</p>') + (faltanPag>0?`<div class="row" style="justify-content:center;margin:12px 0"><button id="btnGalMas" class="primary">Mostrar más (${faltanPag} galerías restantes)</button></div>`:'');
  $('btnGalMas')?.addEventListener('click',()=>{ galPag++; renderGalerias(); });
  hidratarImgs($('galBody'));
  document.querySelectorAll('#galVista button').forEach(b=>b.classList.toggle('on',b.dataset.v===galVista));
  $('btnColapsar').textContent = [...lotes.keys()].every(k=>colapsados.has(k)) && lotes.size ? 'Expandir todo' : 'Colapsar todo';
  $('galStats').textContent = `${visibles} de ${lotes.size} galerías · ${total} imágenes · ${fav} favoritas`;
}
function selectOpts(list, cur, vacio){ return `<option value="">${vacio}</option>`+list.map(c=>`<option value="${c.id}" ${c.id===cur?'selected':''}>${esc(c.nombre)}</option>`).join(''); }
function abrirEditor(sec, key){
  if(editando===key){ editando=null; renderGalerias(); return; }
  editando=key; renderGalerias(); sec=document.querySelector(`section[data-lote="${CSS.escape(key)}"]`);
  const meta=lotesMeta.get(key)||{}; const ruta=rutaClasif(meta.clasif_id); const [n1,n2,n3]=[ruta[0]?.id,ruta[1]?.id,ruta[2]?.id];
  const f=document.createElement('form'); f.className='lote-ed';
  f.innerHTML=`<label class="f">Nombre<input type="text" name="nombre" maxlength="60" value="${esc(meta.nombre||'')}" placeholder="p. ej. Fernanda"></label>
    <label class="f">Tipo<select name="n1">${selectOpts(hijos(null),n1,'—')}</select></label>
    <label class="f">Subgrupo<select name="n2">${selectOpts(n1?hijos(n1):[],n2,'—')}</select></label>
    <label class="f">Detalle<select name="n3">${selectOpts(n2?hijos(n2):[],n3,'—')}</select></label>
    <label class="f full" style="display:grid">Notas<input type="text" name="notas" value="${esc(meta.notas||'')}"></label>
    <div class="f full" style="display:grid">Tags
      <div class="tagedit" id="tagedit"><input type="text" name="tagin" list="tagsDL" placeholder="escribe y Enter: existente o nuevo" autocomplete="off"><datalist id="tagsDL">${[...tags.values()].map(t=>`<option value="${esc(t.nombre)}">`).join('')}</datalist></div>
    </div>
    <div class="full"><button class="primary" type="submit">Guardar</button><button type="button" class="cancel">Cancelar</button></div>`;
  f.n1.addEventListener('change',()=>{ f.n2.innerHTML=selectOpts(f.n1.value?hijos(Number(f.n1.value)):[],null,'—'); f.n3.innerHTML=selectOpts([],null,'—'); });
  f.n2.addEventListener('change',()=>{ f.n3.innerHTML=selectOpts(f.n2.value?hijos(Number(f.n2.value)):[],null,'—'); });
  f.querySelector('.cancel').addEventListener('click',()=>{ editando=null; renderGalerias(); });
  // tags: estado local hasta Guardar
  const sel=new Set(loteTags.get(key)||[]);
  const te=f.querySelector('#tagedit'), ti=f.tagin;
  const pintaTags=()=>{ te.querySelectorAll('.tag').forEach(x=>x.remove()); [...sel].map(id=>tags.get(id)).filter(Boolean).forEach(t=>{ const sp=document.createElement('span'); sp.className='tag'; sp.innerHTML=`${esc(t.nombre)}<button type="button" data-id="${t.id}" title="Quitar">✕</button>`; te.insertBefore(sp, ti); }); };
  pintaTags();
  te.addEventListener('click',e=>{ const b=e.target.closest('button[data-id]'); if(b){ sel.delete(Number(b.dataset.id)); pintaTags(); } });
  ti.addEventListener('keydown', async e=>{ if(e.key!=='Enter' && e.key!==',') return; e.preventDefault(); const t=await tagPorNombre(ti.value); if(t){ sel.add(t.id); ti.value=''; pintaTags(); } });
  ti.addEventListener('change', async ()=>{ if(!ti.value.trim()) return; const t=await tagPorNombre(ti.value); if(t){ sel.add(t.id); ti.value=''; pintaTags(); } });
  f.addEventListener('submit', async ev=>{
    ev.preventDefault();
    const clasif_id = Number(f.n3.value||f.n2.value||f.n1.value)||null;
    const row={ user_id:session.user.id, lote:key, nombre:f.nombre.value.trim()||null, clasif_id, notas:f.notas.value.trim()||null, portada_seq:(lotesMeta.get(key)||{}).portada_seq||null, actualizado:new Date().toISOString() };
    if(ti.value.trim()){ const t=await tagPorNombre(ti.value); if(t) sel.add(t.id); }
    const { error } = await sb.from('arkaphoto_lotes').upsert(row);
    if(error){ toast('No se guardó: '+error.message); return; }
    const antes=loteTags.get(key)||new Set();
    const quitar=[...antes].filter(id=>!sel.has(id)), poner=[...sel].filter(id=>!antes.has(id));
    if(quitar.length){ const { error:e1 } = await sb.from('arkaphoto_lote_tags').delete().eq('lote',key).in('tag_id',quitar); if(e1) toast('Tags: '+e1.message); }
    if(poner.length){ const { error:e2 } = await sb.from('arkaphoto_lote_tags').insert(poner.map(tag_id=>({ user_id:session.user.id, lote:key, tag_id }))); if(e2) toast('Tags: '+e2.message); }
    loteTags.set(key,new Set(sel));
    lotesMeta.set(key,row); editando=null; toast('Galería guardada'); renderGalerias();
  });
  sec.querySelector('.ghead').after(f); f.nombre.focus();
}
async function setTagLote(key, tagId, poner){
  if(poner){ const { error } = await sb.from('arkaphoto_lote_tags').insert({ user_id:session.user.id, lote:key, tag_id:tagId }); if(error && error.code!=='23505'){ toast('Tag: '+error.message); return false; } if(!loteTags.has(key)) loteTags.set(key,new Set()); loteTags.get(key).add(tagId); }
  else { const { error } = await sb.from('arkaphoto_lote_tags').delete().eq('lote',key).eq('tag_id',tagId); if(error){ toast('Tag: '+error.message); return false; } loteTags.get(key)?.delete(tagId); }
  return true;
}
$('galBody').addEventListener('click', async e=>{
  const ed=e.target.closest('button.ed'); if(ed){ abrirEditor(ed.closest('section'), ed.dataset.lote); return; }
  const qd=e.target.closest('button.qdel'); if(qd){ const key=qd.closest('section').dataset.lote; if(await setTagLote(key, Number(qd.dataset.id), false)) renderGalerias(); return; }
  const qa=e.target.closest('button.qadd'); if(qa){
    const key=qa.dataset.lote, wrap=qa.parentElement;
    wrap.innerHTML=`<input type="text" list="tagsDLq" placeholder="tag y Enter" autocomplete="off"><datalist id="tagsDLq">${[...tags.values()].map(t=>`<option value="${esc(t.nombre)}">`).join('')}</datalist>`;
    const inp=wrap.querySelector('input'); inp.focus();
    const commit=async ()=>{ const v=inp.value.trim(); if(!v){ renderGalerias(); return; } const t=await tagPorNombre(v); if(t) await setTagLote(key,t.id,true); renderGalerias(); };
    inp.addEventListener('keydown', ev=>{ if(ev.key==='Enter'||ev.key===','){ ev.preventDefault(); commit(); } if(ev.key==='Escape') renderGalerias(); });
    inp.addEventListener('blur', ()=>setTimeout(commit,150));
    return;
  }
  const hid=e.target.closest('button.hid'); if(hid){
    const id=Number(hid.dataset.id); let it; for(const L of lotes.values()) for(const x of L.items.values()) if(x.id===id) it=x;
    if(!it) return; const nuevo=!it.oculta;
    const { error } = await sb.from('arkaphoto_imagenes').update({ oculta:nuevo }).eq('id',id);
    if(error){ toast('No se guardó: '+error.message); return; }
    it.oculta=nuevo; renderGalerias(); return;
  }
  const mkp=e.target.closest('button.mkp'); if(mkp){
    const key=mkp.closest('section').dataset.lote, seq=Number(mkp.dataset.seq);
    const meta=lotesMeta.get(key)||{lote:key}; const row={ ...meta, user_id:session.user.id, lote:key, portada_seq:seq, actualizado:new Date().toISOString() };
    const { error } = await sb.from('arkaphoto_lotes').upsert(row); if(error){ toast('No se guardó: '+error.message); return; }
    lotesMeta.set(key,row); renderGalerias(); return;
  }
  const col=e.target.closest('button.colap'); if(col){ const k=col.dataset.lote; colapsados.has(k)?colapsados.delete(k):colapsados.add(k); guardaColapsados(); renderGalerias(); return; }
  const pz=e.target.closest('button.zip'); if(pz){ descargarZip([pz.dataset.lote]); return; }
  const ps=e.target.closest('button.pase'); if(ps){ abrirPase(ps.dataset.lote); return; }
  const sv=e.target.closest('button.sav'); if(sv){ const k=sv.closest('section').dataset.lote, L=lotes.get(k), seq=Number(sv.dataset.seq); await asegurarUrls([k]); guardarFoto(L.items.get(seq).url, nombre(L,seq)); return; }
  const op=e.target.closest('button.opn'); if(op){ const k=op.closest('section').dataset.lote, L=lotes.get(k), seq=Number(op.dataset.seq); const w=window.open('','_blank'); await asegurarUrls([k]); if(w) w.location=L.items.get(seq).url; return; }
  const img=e.target.closest('img[data-seq]'); if(img){ abrirPase(img.closest('section').dataset.lote, Number(img.dataset.seq)); return; }
  const b=e.target.closest('button.fav'); if(!b) return;
  const id=Number(b.dataset.id); let it; for(const L of lotes.values()) for(const x of L.items.values()) if(x.id===id) it=x;
  if(!it) return;
  const nuevo=!it.favorita;
  const { error } = await sb.from('arkaphoto_imagenes').update({ favorita: nuevo }).eq('id', id);
  if(error){ toast('No se guardó: '+error.message); return; }
  it.favorita=nuevo; b.classList.toggle('on',nuevo); b.textContent=nuevo?'★':'☆';
});

// ---------- PASE (lightbox)
let pase = { lista:[], i:0 };
async function abrirPase(key, seq){
  const L=lotes.get(key); if(!L) return; await asegurarUrls([key]);
  pase.lista=[...L.items].filter(([,it])=>!it.oculta).map(([s,it])=>({seq:s,url:it.url,nombre:nombre(L,s)}));
  if(!pase.lista.length){ toast('Sin fotos visibles'); return; }
  pase.i=Math.max(0, pase.lista.findIndex(x=>x.seq===seq)); $('lbTitulo').textContent=etiqueta(key);
  $('lb').hidden=false; document.body.style.overflow='hidden'; pintaPase();
}
function pintaPase(){ const x=pase.lista[pase.i]; $('lbImg').src=x.url; $('lbNombre').textContent=x.nombre; $('lbPos').textContent=`${pase.i+1} / ${pase.lista.length} · #${x.seq}`; const n=pase.lista[(pase.i+1)%pase.lista.length]; if(n) new Image().src=n.url; }
function cerrarPase(){ $('lb').hidden=true; document.body.style.overflow=''; }
$('lbPrev').addEventListener('click',()=>{ pase.i=(pase.i-1+pase.lista.length)%pase.lista.length; pintaPase(); });
$('lbNext').addEventListener('click',()=>{ pase.i=(pase.i+1)%pase.lista.length; pintaPase(); });
$('lbCerrar').addEventListener('click',cerrarPase);
$('lbAbrir').addEventListener('click',()=>{ const x=pase.lista[pase.i]; if(x) window.open(x.url,'_blank','noopener'); });
async function guardarFoto(url, nombreArch){
  try{ const r=await fetch(url); if(!r.ok) throw 0; const b=await r.blob(); const a=document.createElement('a'); a.href=URL.createObjectURL(b); a.download=nombreArch; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),30000); toast('Guardada: '+nombreArch); }
  catch{ toast('No se pudo descargar; usa Abrir y guarda desde la pestaña'); }
}
$('lbGuardar').addEventListener('click', ()=>{ const x=pase.lista[pase.i]; if(x) guardarFoto(x.url, x.nombre); });
document.addEventListener('keydown',e=>{ if($('lb').hidden) return; if(e.key==='ArrowLeft') $('lbPrev').click(); else if(e.key==='ArrowRight') $('lbNext').click(); else if(e.key==='Escape') cerrarPase(); });

// ---------- DESCARGA ZIP (en el navegador; excluye ocultas)
async function descargarZip(keys){
  if(typeof JSZip==='undefined'){ toast('No cargó la librería ZIP'); return; }
  const zip=new JSZip(); let n=0, fallas=0;
  toast('Armando ZIP…');
  await asegurarUrls(keys);
  for(const key of keys){
    const L=lotes.get(key); if(!L) continue; const carpeta=zip.folder(etiqueta(key).replace(/[^\w\- ]+/g,'_'));
    for(const [seq,it] of L.items){ if(it.oculta) continue;
      try{ const r=await fetch(it.url); if(!r.ok) throw 0; carpeta.file(nombre(L,seq), await r.blob()); n++; }catch{ fallas++; }
    }
  }
  if(!n){ toast('Nada que descargar'); return; }
  const blob=await zip.generateAsync({ type:'blob', compression:'STORE' });
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=(keys.length===1?etiqueta(keys[0]).replace(/[^\w\- ]+/g,'_'):'arkaphoto-galerias')+'.zip'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href),60000);
  toast(`ZIP listo: ${n} fotos${fallas?` · ${fallas} fallaron`:''}`);
}
$('btnZipTodo').addEventListener('click', ()=>{ const keys=[...document.querySelectorAll('#galBody section[data-lote]')].map(s=>s.dataset.lote); if(!keys.length){ toast('Nada visible'); return; } descargarZip(keys); });

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
  const elegidos=resolverDuplicados();
  await subir(elegidos);
  const nuevos=[...new Set(elegidos.map(({m})=>`${m[1]}-${m[2].toLowerCase()}`))];
  nuevos.forEach(k=>{ sesionLotes.add(k); selCarga.add(k); });
  await cargarImagenes();
  $('upStatus').textContent += ' · Sondeando tamaño de lote en la ruta pública…';
  const n=await sondear(nuevos); $('upStatus').textContent = $('upStatus').textContent.replace(' · Sondeando tamaño de lote en la ruta pública…', n?` · ${n} lote(s) sondeados`:'');
  mostrarCargaTab('cargar');
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
    const ourl=URL.createObjectURL(file); const d=(await medir(ourl))||{}; URL.revokeObjectURL(ourl);
    const ins = await sb.from('arkaphoto_imagenes').upsert({ user_id:session.user.id, lote, seq, ext, nombre:canon, ruta, bytes:file.size, origen:'subida', ancho:d.ancho||null, alto:d.alto||null }, { onConflict:'user_id,lote,seq' });
    if(ins.error) toast(`Subida pero sin registro ${canon}: ${ins.error.message}`);
  }
  $('upStatus').textContent = elegidos.length ? `${elegidos.length} imágenes subidas.` : '';
}
function mostrarCargaTab(t){
  cargaTab=t;
  document.querySelectorAll('#cargaTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  document.querySelectorAll('#v-carga [data-ctab]').forEach(d=>d.hidden = d.dataset.ctab!==t);
  render();
}
$('cargaTabs').addEventListener('click', e=>{ const b=e.target.closest('button[data-t]'); if(b) mostrarCargaTab(b.dataset.t); });

function render(){
  const hist = cargaTab==='hist';
  let keys = hist ? [...lotes.keys()] : [...sesionLotes].filter(k=>lotes.has(k));
  if(hist && histFiltro!=='todos') keys = keys.filter(k=>{ const L=lotes.get(k), meta=lotesMeta.get(k)||{}; const f=faltantes(L,k).length;
    return histFiltro==='incompletos' ? f>0 : histFiltro==='completos' ? f===0 : histFiltro==='sinclasif' ? !meta.clasif_id : histFiltro==='sinsondear' ? !meta.sondeado_en : true; });
  const histTotal = lotes.size;
  const nArch=keys.reduce((a,k)=>a+lotes.get(k).items.size,0);
  $('resumen').hidden = hist || (nArch===0 && bad.length===0);
  $('lotes').hidden = hist || keys.length===0;
  $('sArch').textContent=nArch; $('sLotes').textContent=keys.length; $('sBad').textContent=bad.length; $('sDup').textContent=dupes.length;
  if(!hist && !keys.length) $('upStatus').textContent = $('upStatus').textContent || 'Aquí verás solo lo que subas en esta sesión; lo anterior está en Histórico.';
  lastMissing=[]; let total=0;
  const frag=document.createDocumentFragment();
  for(const key of keys){
    const L=lotes.get(key);
    const miss=faltantes(L,key), hasta=rangoEsperado(L,key); total+=miss.length;
    miss.forEach(n=>lastMissing.push({key,L,n}));
    const d=document.createElement('div'); d.className='lote'; d.dataset.lote=key;
    const ruta=rutaClasif((lotesMeta.get(key)||{}).clasif_id).map(c=>esc(c.nombre)).join(' › ');
    const sel = hist?selHist:selCarga;
    d.innerHTML = `<div class="lote-head"><input type="checkbox" class="selh" data-lote="${esc(key)}" ${sel.has(key)?'checked':''}><span class="etq" style="font-size:.9rem" title="${esc(key)}">${esc(etiqueta(key))}</span><span class="ruta">${ruta||'<span class="pill warn">sin clasificar</span>'}</span><span class="pill ${miss.length?'miss':'ok'}">${miss.length?miss.length+' faltantes':'completo'}</span>${barra(L.items.size, hasta, !!(lotesMeta.get(key)||{}).sondeado_en)}</div>`;
    const g=document.createElement('div'); g.className='seq';
    for(let i=1;i<=MAX;i++){
      const c=document.createElement('div'); c.className='cell'; c.dataset.n=i;
      const it=L.items.get(i);
      if(it){ c.classList.add('has'); if(it.origen==='traida') c.classList.add('traida'); const im=document.createElement('img'); im.loading='lazy'; if(it.url) im.src=it.url; else im.dataset.ruta=it.ruta; im.alt=nombre(L,i); c.appendChild(im); }
      else if(i<=hasta){ c.classList.add('miss'); c.textContent=i; }
      else { c.classList.add('out'); c.textContent=i; }
      c.title=nombre(L,i)+(it?` · ${it.origen}`:i<=hasta?' · falta':' · fuera de rango');
      g.appendChild(c);
    }
    d.appendChild(g); frag.appendChild(d);
  }
  (hist?$('histLotes'):$('lotes')).replaceChildren(frag); hidratarImgs(hist?$('histLotes'):$('lotes'));
  if(hist && !keys.length) $('histLotes').innerHTML=`<p class="note">${histTotal?'Ningún lote cumple el filtro.':'Aún no hay lotes.'}</p>`;
  if(hist){ const b=$('btnSelTodos'); b.textContent=`Seleccionar visibles (${keys.length})`; document.querySelectorAll('#histFiltro button').forEach(x=>x.classList.toggle('on',x.dataset.f===histFiltro)); }
  $('selN').textContent=`${[...selHist].filter(k=>lotes.has(k)).length} seleccionados`;
  $('cClasif').hidden = hist || keys.length===0;
  $('cSelN').textContent=`${[...selCarga].filter(k=>lotes.has(k)).length} de ${keys.length} seleccionados`;
  $('sFalt').textContent=total;
  $('pregunta').hidden = true; $('faltantes').hidden = true;
  $('faltanBanner').hidden = hist || total===0;
  if(!hist && total) $('faltanTxt').textContent = `Faltan ${total} foto${total===1?'':'s'} en ${keys.filter(k=>faltantes(lotes.get(k),k).length).length} lote(s) de esta carga`;
  if(total) $('preguntaTxt').textContent = `Hay ${total} imágenes faltantes en ${keys.filter(k=>faltantes(lotes.get(k),k).length).length} lote(s). ¿Quieres que validemos si existen en la ruta pública?`;
  $('noRec').hidden = bad.length===0; $('badList').textContent = bad.join('\n');
  $('dupSec').hidden = dupes.length===0;
  const dl=$('dupList'); dl.replaceChildren();
  dupes.forEach(d=>{ const li=document.createElement('li'); li.innerHTML=`<span class="n ${d.ok?'okc':''}">${d.ok?'✓':'!'}</span><span>${esc(d.name)}</span><span class="note">${esc(d.estado)}</span>`; dl.appendChild(li); });
}
$('histLotes').addEventListener('change', e=>{ const c=e.target.closest('input.selh'); if(!c) return; c.checked?selHist.add(c.dataset.lote):selHist.delete(c.dataset.lote); $('selN').textContent=`${selHist.size} seleccionados`; });
$('lotes').addEventListener('change', e=>{ const c=e.target.closest('input.selh'); if(!c) return; c.checked?selCarga.add(c.dataset.lote):selCarga.delete(c.dataset.lote); $('cSelN').textContent=`${selCarga.size} de ${sesionLotes.size} seleccionados`; });
$('btnCargaOk').addEventListener('click', async ()=>{
  const cid=cascCarga.valor(); if(!cid){ toast('Elige al menos el Tipo'); return; }
  const keys=[...selCarga].filter(k=>lotes.has(k)); if(!keys.length){ toast('Marca al menos un lote'); return; }
  const n=await clasificarLotes(keys, cid); const fotos=keys.reduce((a,k)=>a+lotes.get(k).items.size,0);
  render(); $('cListo').hidden=false; $('cListoTxt').textContent=`${fotos} fotos en ${n} lote(s) → ${rutaClasif(cid).map(c=>c.nombre).join(' › ')}`;
  $('cListo').scrollIntoView({behavior:'smooth',block:'center'});
});
$('btnSeguir').addEventListener('click',()=>{ $('cListo').hidden=true; });
$('btnNuevaCarga').addEventListener('click', async ()=>{
  sesionLotes.clear(); selCarga.clear(); bad.length=0; dupes=[]; lastMissing=[]; cascCarga.reset();
  $('cListo').hidden=true; $('upStatus').textContent='Listo para una nueva carga.';
  await cargarTodo(); render(); window.scrollTo({top:0,behavior:'smooth'});
});
$('histFiltro').addEventListener('click', e=>{ const b=e.target.closest('button[data-f]'); if(!b) return; histFiltro=b.dataset.f; render(); });
$('btnSelTodos').addEventListener('click', ()=>{ const visibles=[...document.querySelectorAll('#histLotes input.selh')].map(c=>c.dataset.lote); const quitar=visibles.length && visibles.every(k=>selHist.has(k)); visibles.forEach(k=>quitar?selHist.delete(k):selHist.add(k)); render(); });
$('btnMasivo').addEventListener('click', ()=>{ if(!selHist.size){ toast('Selecciona al menos un lote'); return; } $('masivo').hidden=false; });
$('btnMasivoNo').addEventListener('click', ()=>{ $('masivo').hidden=true; });
$('btnMasivoOk').addEventListener('click', async ()=>{ const cid=cascMasivo.valor(); if(!cid){ toast('Elige al menos el Tipo'); return; } const n=await clasificarLotes([...selHist].filter(k=>lotes.has(k)), cid); toast(`${n} lote(s) clasificados`); $('masivo').hidden=true; selHist.clear(); render(); });
$('btnSondearSel').addEventListener('click', async ()=>{ const keys=(selHist.size?[...selHist]:[...lotes.keys()]).filter(k=>lotes.has(k)); toast('Sondeando…'); const n=await sondear(keys,true); toast(`${n} lote(s) sondeados`); render(); });
$('btnValidarSel').addEventListener('click', async ()=>{
  await cargarImagenes(); await cargarLotesMeta();
  const keys=(selHist.size?[...selHist]:[...lotes.keys()]).filter(k=>lotes.has(k));
  await sondear(keys); render();
  lastMissing=[]; keys.forEach(key=>{ const L=lotes.get(key); faltantes(L,key).forEach(n=>lastMissing.push({key,L,n})); });
  if(!lastMissing.length){ toast('Sin faltantes en '+(selHist.size?'los seleccionados':'ningún lote')); $('faltantes').hidden=true; return; }
  $('btnSi').click();
});
$('btnFaltanVer').addEventListener('click',()=>$('btnSi').click());
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
  // Estado fresco: lo que haya entrado por la cola u otra pestaña ya no se pide
  await cargarImagenes();
  const porLote = new Map(); let yaEstaban=0;
  lastMissing.forEach(({key,n})=>{ const L=lotes.get(key); if(!L) return; if(L.items.has(n)){ yaEstaban++; return; } if(!porLote.has(key)) porLote.set(key,{ext:L.ext,seqs:[]}); porLote.get(key).seqs.push(n); });
  let ok=0, no=0, ex=0; const fallas=[];
  for(const [lote,{ext,seqs}] of porLote){
    $('traerTxt').textContent=`Trayendo ${seqs.length} del lote ${lote}…`;
    const r = await post('/api/traer',{lote,ext,seqs},true);
    if(!r.ok){ fallas.push(`${lote}: ${r.j.error||r.status}`); continue; }
    r.j.resultados.forEach(x=>{ if(x.ok) ok++; else if(x.status==='existe') ex++; else { no++; fallas.push(`${x.nombre}: ${describeFalla(x)}`); } });
  }
  await cargarImagenes(); render();
  $('faltantes').hidden=false; $('pregunta').hidden=true;
  $('traerTxt').textContent = `Traídas: ${ok}. Ya estaban en el sistema: ${ex+yaEstaban}. No encontradas o con error: ${no}.` + (fallas.length?`\n${fallas.join('\n')}`:'');
  $('btnTraer').disabled=false;
});
const describeFalla = x => x.status==='existe'?'ya existe en el sistema':x.status==='omitida'?`omitida (${x.error})`:x.status===404?'no existe en la ruta':`HTTP ${x.status}${x.error?' '+x.error:''}`;

// ---------- CARGA DE URL (texto o archivo .txt/.json) → análisis → cola persistente
let archivoNombre = '';
const RX_URL = /https?:\/\/[^\s"'<>\\\]\[,]+?\.(?:png|jpe?g)/gi;
// Desenvuelve proxies de redimensión: la última aparición de http(s):// dentro de la URL es el original
const desenvolver = u => { const i=Math.max(u.lastIndexOf('https://'), u.lastIndexOf('http://')); return i>0 ? u.slice(i) : u; };
function extraerUrls(texto){
  const set=new Set();
  let m; RX_URL.lastIndex=0;
  while((m=RX_URL.exec(texto))) set.add(desenvolver(m[0]));
  return [...set];
}
$('urlsFile').addEventListener('change', async e=>{
  const f=e.target.files[0]; if(!f) return; archivoNombre=f.name;
  const texto=await f.text(); let urls=[];
  if(f.name.toLowerCase().endsWith('.json')){ try{ const j=JSON.parse(texto); const walk=o=>{ if(typeof o==='string') urls.push(o); else if(Array.isArray(o)) o.forEach(walk); else if(o&&typeof o==='object') Object.values(o).forEach(walk); }; walk(j); }catch{ urls=[]; } }
  if(!urls.length) urls=extraerUrls(texto); else urls=[...new Set(urls.flatMap(u=>extraerUrls(u)))];
  $('urlsTxt').value=urls.join('\n'); $('urlsFileN').textContent=`${f.name}: ${urls.length} URLs`; e.target.value='';
  $('btnAnalizar').click();
});
$('btnAnalizar').addEventListener('click', async ()=>{
  const btn=$('btnAnalizar'); btn.disabled=true;
  try{
    const lineas=extraerUrls($('urlsTxt').value);
    // 1. agrupar por lote
    const porLote=new Map(); let bad=0;
    for(const u of lineas){
      try{ const url=new URL(u); const nombreArch=decodeURIComponent(url.pathname.split('/').pop()||''); const m=nombreArch.match(RX);
        if(url.protocol!=='https:'||!m){ bad++; continue; }
        const seq=parseInt(m[3],10); if(seq<1||seq>32){ bad++; continue; }
        const lote=`${m[1]}-${m[2].toLowerCase()}`, ext=m[5].toLowerCase(), base=u.slice(0,u.lastIndexOf('/'));
        if(!porLote.has(lote)) porLote.set(lote,{ lote, ext, base, seqs:new Set() }); porLote.get(lote).seqs.add(seq);
      }catch{ bad++; }
    }
    const lotesArr=[...porLote.values()]; const cid=cascUrls.valor();
    $('uTot').textContent=lineas.length; $('uLotes').textContent=lotesArr.length; $('uBad').textContent=bad; $('urlsStats').hidden=!lineas.length;
    if(!lotesArr.length){ $('urlsResumen').textContent='Sin URLs reconocidas'; return; }
    // 2. sondear por tandas en el servidor y encolar conforme llegan resultados
    let traer=0, comp=0, ex=0, enc=0, hechos=0, filas=[]; const pendientesRe=[];
    const encolar=async rows=>{ for(let i=0;i<rows.length;i+=500){ const { error } = await sb.from('arkaphoto_cola').upsert(rows.slice(i,i+500),{ onConflict:'user_id,lote,seq', ignoreDuplicates:true }); if(error){ toast('Encolar: '+error.message); return; } } };
    for(let i=0;i<lotesArr.length;i+=60){
      const tanda=lotesArr.slice(i,i+60).map(L=>({ lote:L.lote, ext:L.ext, base:L.base, seqs:[...L.seqs] }));
      $('urlsResumen').textContent=`Sondeando lotes… ${Math.min(i+60,lotesArr.length)} de ${lotesArr.length}`;
      const r=await post('/api/cola',{ accion:'analizar', lotes:tanda },true);
      if(!r.ok){ toast('Analizar: '+(r.j.error||r.status)); break; }
      const rows=[];
      for(const x of r.j.lotes){
        const L=porLote.get(x.lote); if(!L) continue;
        if(x.pendiente){ pendientesRe.push(L); continue; }
        if(x.error){ filas.push(`<tr><td class="k">${esc(x.lote)}</td><td colspan="5" class="err">${esc(x.error)}</td></tr>`); continue; }
        const listadas=[...L.seqs].filter(sq=>x.faltan.includes(sq)).length, completadas=x.faltan.length-listadas;
        traer+=x.faltan.length; comp+=completadas; ex+=x.existen.length; enc+=x.encoladas.length; hechos++;
        x.faltan.forEach(sq=>rows.push({ user_id:session.user.id, lote:x.lote, seq:sq, ext:L.ext, nombre:`${x.lote}-${sq}.${L.ext}`, url:`${L.base}/${x.lote}-${sq}.${L.ext}`, origen_archivo:archivoNombre||'texto', clasif_id:cid }));
        if(filas.length<400) filas.push(`<tr><td class="k">${esc(x.lote)}</td><td>${L.seqs.size}</td><td>${x.tamano}</td><td><b>${x.faltan.length}</b>${completadas?` <span class="note">(+${completadas} completadas)</span>`:''}</td><td>${x.existen.length}</td><td>${x.encoladas.length}</td></tr>`);
      }
      await encolar(rows);
      $('uTraer').textContent=traer; $('uComp').textContent=comp; $('uEx').textContent=ex; $('uCola').textContent=enc;
      $('urlsBody').innerHTML=filas.join(''); $('urlsTabla').hidden=!filas.length; $('urlsTablaN').textContent=filas.length>=400?'Se muestran los primeros 400 lotes.':'';
      if(pendientesRe.length){ lotesArr.push(...pendientesRe.splice(0)); }
    }
    $('urlsResumen').textContent=`${hechos} lotes analizados · ${traer} fotos encoladas (${comp} completadas) · ${ex} ya existían`;
    toast(`${traer} fotos en cola`); await colaEstado();
    if(traer) $('btnColaIr').scrollIntoView({behavior:'smooth',block:'center'});
  } finally { btn.disabled=false; }
});

// ---------- cola: estado y procesamiento en bucle
let colaCorriendo=false, colaTotalInicial=0;
async function colaEstado(){
  const { data, error } = await sb.rpc('arkaphoto_cola_resumen'); if(error){ $('colaTxt').textContent='Cola: '+error.message; return null; }
  const m=Object.fromEntries((data||[]).map(r=>[r.estado,{n:Number(r.n),bytes:Number(r.bytes)}]));
  const g=k=>m[k]?.n||0; const pend=g('pendiente')+g('procesando'), tra=g('traida'), ex=g('existe'), err=g('error');
  $('cPend').textContent=pend; $('cTra').textContent=tra; $('cEx').textContent=ex; $('cErr').textContent=err; $('cBytes').textContent=fmt(m.traida?.bytes||0);
  const total=pend+tra+ex+err, hechas=tra+ex+err, pct=total?Math.round(100*hechas/total):0;
  $('colaBarra').querySelector('i').style.width=pct+'%'; $('colaBarra').classList.toggle('full',total>0&&pend===0);
  $('colaBarraTxt').textContent = total?`${hechas} de ${total} · ${pct}%${colaCorriendo?' · procesando…':pend?' · en pausa':' · terminada'}`:'sin cola';
  $('btnColaIr').hidden=colaCorriendo||!pend; $('btnColaPausa').hidden=!colaCorriendo;
  if(err){ const { data: errs } = await sb.from('arkaphoto_cola').select('nombre,error,http_status').eq('estado','error').order('procesado_en',{ascending:false}).limit(20);
    $('colaErrores').innerHTML=(errs||[]).map(x=>`<li><span class="n">!</span><span>${esc(x.nombre)}</span><span class="note">${esc(x.error||x.http_status||'')}</span></li>`).join(''); }
  else $('colaErrores').innerHTML='';
  return { pend, tra, ex, err, total };
}
async function colaBucle(){
  colaCorriendo=true; await colaEstado();
  while(colaCorriendo){
    const r=await post('/api/cola',{ accion:'procesar', n:24 },true);
    if(!r.ok){ toast('Cola: '+(r.j.error||r.status)); break; }
    $('colaTxt').textContent=`Última tanda: ${r.j.procesadas} procesadas · ${r.j.traidas||0} traídas · ${r.j.existe||0} existían · ${r.j.error||0} errores · ${((r.j.ms||0)/1000).toFixed(1)} s`;
    const e=await colaEstado();
    if(r.j.fin || !e || !e.pend) break;
    if(vistaActual()==='galerias'){ await cargarImagenes(); renderGalerias(); }
  }
  colaCorriendo=false; await colaEstado();
  if(lotes.size!==undefined){ await cargarImagenes(); if(vistaActual()==='galerias') renderGalerias(); }
}
$('btnColaIr').addEventListener('click', ()=>{ if(!colaCorriendo) colaBucle(); });
$('btnColaPausa').addEventListener('click', ()=>{ colaCorriendo=false; $('colaTxt').textContent='Pausando al terminar la tanda actual…'; });
$('btnColaRetry').addEventListener('click', async ()=>{ const r=await post('/api/cola',{ accion:'reintentar' },true); toast(r.ok?`${r.j.reencoladas} reencoladas`:(r.j.error||r.status)); await colaEstado(); });
$('btnColaLimpiar').addEventListener('click', async ()=>{ const r=await post('/api/cola',{ accion:'limpiar' },true); toast(r.ok?`${r.j.borradas} filas borradas`:(r.j.error||r.status)); await colaEstado(); });

// ---------- ADMIN · pestañas (Sistema verifica solo al abrirse)
let adminTab = 'url'; try{ adminTab = localStorage.getItem('arkaphoto-admin-tab') || 'url'; }catch{}
function mostrarTab(t){
  adminTab=t; try{ localStorage.setItem('arkaphoto-admin-tab',t); }catch{}
  document.querySelectorAll('#adminTabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  document.querySelectorAll('#v-admin [data-tab]').forEach(d=>d.hidden = d.dataset.tab!==t);
  if(t==='sistema'){ verificarSistema(); renderMigraciones(); }
}
$('adminTabs').addEventListener('click', e=>{ const b=e.target.closest('button[data-t]'); if(b) mostrarTab(b.dataset.t); });

// ---------- ADMIN · tags
function renderAdminTags(){
  const uso=new Map(); for(const set of loteTags.values()) for(const id of set) uso.set(id,(uso.get(id)||0)+1);
  $('adminTags').innerHTML=[...tags.values()].sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(t=>`<span class="tag" data-id="${t.id}">${esc(t.nombre)} <small>${uso.get(t.id)||0}</small><button type="button" class="ren" title="Renombrar">✎</button><button type="button" class="del" title="Borrar">✕</button></span>`).join('') || '<span class="note">Sin tags todavía.</span>';
}
$('adminTags').addEventListener('click', async e=>{
  const sp=e.target.closest('.tag[data-id]'); if(!sp) return; const id=Number(sp.dataset.id), t=tags.get(id);
  if(e.target.closest('.ren')){
    const nuevo=prompt('Nuevo nombre del tag', t.nombre); if(!nuevo||!nuevo.trim()||nuevo.trim()===t.nombre) return;
    const { error } = await sb.from('arkaphoto_tags').update({ nombre:nuevo.trim() }).eq('id',id);
    if(error){ toast(error.code==='23505'?'Ya existe ese tag':error.message); return; }
    t.nombre=nuevo.trim(); renderAdminTags();
  } else if(e.target.closest('.del')){
    let uso=0; for(const set of loteTags.values()) if(set.has(id)) uso++;
    if(uso){ toast(`Lo usan ${uso} galería(s); quítalo primero`); return; }
    if(!confirm(`¿Borrar el tag "${t.nombre}"?`)) return;
    const { error } = await sb.from('arkaphoto_tags').delete().eq('id',id);
    if(error){ toast(error.message); return; }
    tags.delete(id); renderAdminTags();
  }
});

// ---------- ADMIN · clasificación
function renderArbol(){
  const pinta=(nivel, pid, sel)=>{
    const ul=$('cl'+nivel); ul.innerHTML = hijos(pid).map(c=>`<li class="${sel===c.id?'on':''}" data-id="${c.id}"><button class="item" type="button">${esc(c.nombre)}</button><button class="ico ren" type="button" title="Renombrar">✎</button><button class="ico del" type="button" title="Borrar">✕</button></li>`).join('') || '<li class="note" style="padding:6px 8px">Vacío</li>';
  };
  pinta(1,null,clSel[1]);
  const f2=document.querySelector('#cl2').nextElementSibling, f3=document.querySelector('#cl3').nextElementSibling;
  if(clSel[1]){ pinta(2,clSel[1],clSel[2]); f2.hidden=false; $('cl2note').hidden=true; } else { $('cl2').innerHTML=''; f2.hidden=true; $('cl2note').hidden=false; }
  if(clSel[2]){ pinta(3,clSel[2],null); f3.hidden=false; $('cl3note').hidden=true; } else { $('cl3').innerHTML=''; f3.hidden=true; $('cl3note').hidden=false; }
}
document.querySelector('.cols3').addEventListener('click', async e=>{
  const li=e.target.closest('li[data-id]'); if(!li) return;
  const id=Number(li.dataset.id), c=clasif.get(id);
  if(e.target.closest('.ren')){
    const nuevo=prompt('Nuevo nombre', c.nombre); if(!nuevo||!nuevo.trim()||nuevo.trim()===c.nombre) return;
    const { error } = await sb.from('arkaphoto_clasif').update({ nombre:nuevo.trim() }).eq('id',id);
    if(error){ toast(error.code==='23505'?'Ya existe ese nombre en este nivel':error.message); return; }
    c.nombre=nuevo.trim(); renderArbol(); await cargarClasif(); return;
  }
  if(e.target.closest('.del')){
    if(hijos(id).length){ toast('Primero borra sus elementos hijos'); return; }
    const usados=[...lotesMeta.values()].filter(m=>m.clasif_id===id).length;
    if(usados){ toast(`Lo usan ${usados} galería(s); reasígnalas primero`); return; }
    if(!confirm(`¿Borrar "${c.nombre}"?`)) return;
    const { error } = await sb.from('arkaphoto_clasif').delete().eq('id',id);
    if(error){ toast(error.message); return; }
    clasif.delete(id); if(clSel[1]===id) clSel={1:null,2:null}; if(clSel[2]===id) clSel[2]=null; renderArbol(); await cargarClasif(); return;
  }
  if(c.nivel===1){ clSel={1:id,2:null}; } else if(c.nivel===2){ clSel[2]=id; }
  renderArbol();
});
document.querySelectorAll('.cols3 form').forEach(f=>f.addEventListener('submit', async e=>{
  e.preventDefault(); const nivel=Number(f.dataset.nivel), inp=f.querySelector('input'), nombre=inp.value.trim(); if(!nombre) return;
  const parent_id = nivel===1?null:nivel===2?clSel[1]:clSel[2]; if(nivel>1 && !parent_id) return;
  const orden = hijos(parent_id).length+1;
  const { data, error } = await sb.from('arkaphoto_clasif').insert({ user_id:session.user.id, parent_id, nivel, nombre, orden }).select().single();
  if(error){ toast(error.code==='23505'?'Ya existe ese nombre en este nivel':error.message); return; }
  clasif.set(data.id,data); inp.value=''; renderArbol(); await cargarClasif();
}));

async function renderMigraciones(){
  const { data, error } = await sb.from('arkaphoto_migraciones').select('num,nombre,version,aplicada_en').order('num');
  $('migBody').innerHTML = error ? `<tr><td colspan="4" class="err">${esc(error.message)}</td></tr>` :
    (data||[]).map(m=>`<tr><td>${m.num}</td><td class="k">${esc(m.nombre)}</td><td>${esc(m.version||'')}</td><td>${new Date(m.aplicada_en).toLocaleString('es-MX')}</td></tr>`).join('');
}
$('btnSistema').addEventListener('click', verificarSistema);
async function verificarSistema(){
  const out=[]; const fila=(n,estado,txt)=>out.push(`<div class="r"><span class="n">${n}</span><span><span class="dot ${estado}"></span>${esc(txt)}</span></div>`);
  $('sysBody').innerHTML='<div class="r"><span class="n">Verificando…</span></div>';
  try{ const t=await fetch('index.html',{cache:'no-store'}).then(r=>r.text()); const m=t.match(/<!-- ARKAPHOTO v([\d.]+) -->/); const v=m?.[1];
    fila('index.html', v===CFG.VERSION?'ok':v?'warn':'bad', v?`servido v${v} · esperado v${CFG.VERSION}`:'sin comentario de versión'); }catch(e){ fila('index.html','bad','no se pudo leer'); }
  try{ const r=await fetch('/api/version',{cache:'no-store'}); const j=await r.json(); const h=r.headers.get('x-app-version');
    fila('/api/version', j.version===CFG.VERSION?'ok':'warn', `backend v${j.version} (header ${h||'—'}) · frontend v${CFG.VERSION}`);
    fila('migración', j.migracion_aplicada===CFG.MIGRACION_ESPERADA?'ok':j.migracion_aplicada>CFG.MIGRACION_ESPERADA?'warn':'bad', `aplicada ${j.migracion_aplicada ?? '?'} · esperada ${CFG.MIGRACION_ESPERADA}`);
  }catch(e){ fila('/api/version','bad','sin respuesta: '+e.message); }
  for(const ep of ['/api/config','/api/auth/send','/api/auth/verify','/api/traer','/api/sondear','/api/cola']){
    try{ const r=await fetch(ep,{method:ep==='/api/config'?'GET':'POST',headers:{'Content-Type':'application/json'},body:ep==='/api/config'?undefined:'{}'}); const h=r.headers.get('x-app-version');
      fila(ep, h===CFG.VERSION?'ok':h?'warn':'bad', h?`v${h}`:'sin x-app-version'); }catch(e){ fila(ep,'bad','sin respuesta'); }
  }
  const { count } = await sb.from('arkaphoto_imagenes').select('id',{count:'exact',head:true});
  const { count: sinDim } = await sb.from('arkaphoto_imagenes').select('id',{count:'exact',head:true}).is('ancho',null);
  fila('imágenes', 'ok', `${count} filas en arkaphoto_imagenes`);
  fila('dimensiones', sinDim?'warn':'ok', sinDim?`${sinDim} fotos sin medir (se miden al abrir Galerías)`:'todas medidas');
  $('sysBody').innerHTML=out.join('');
  $('sysHora').textContent='verificado '+new Date().toLocaleTimeString('es-MX');
}
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
