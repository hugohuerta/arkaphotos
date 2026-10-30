// POST /api/cola { accion: 'procesar', n }      → toma hasta n pendientes, las descarga y las guarda (≈45 s de presupuesto)
// POST /api/cola { accion: 'reintentar' }       → errores → pendiente (intentos < 3)
// POST /api/cola { accion: 'limpiar' }          → borra filas traida/existe
// La cola es persistente: el navegador llama 'procesar' en bucle mientras esté abierto y se reanuda después.
import { createClient } from '@supabase/supabase-js';
import { conVersion } from './_version.js';
import { dimensiones } from './_dims.js';
import { pow2, hostPermitido, conExt, UA, sondearTamano, bajarSeq } from './_origen.js';

export const config = { maxDuration: 60 };
const MAX_BYTES = 50 * 1024 * 1024;
const CONCURRENCIA = 4;
const PRESUPUESTO_MS = 45000;
const MAX_INTENTOS = 3;

export default async function handler(req, res) {
  conVersion(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Faltan variables de Supabase' });
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sin sesión' });
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !user) return res.status(401).json({ error: 'Sesión inválida' });

  const accion = req.body?.accion || 'procesar';
  if (accion === 'reintentar') {
    const { data, error } = await admin.from('arkaphoto_cola').update({ estado: 'pendiente', error: null }).eq('user_id', user.id).eq('estado', 'error').lt('intentos', MAX_INTENTOS).select('id');
    return res.status(error ? 500 : 200).json(error ? { error: error.message } : { reencoladas: data.length });
  }
  if (accion === 'limpiar') {
    const { data, error } = await admin.from('arkaphoto_cola').delete().eq('user_id', user.id).in('estado', ['traida', 'existe']).select('id');
    return res.status(error ? 500 : 200).json(error ? { error: error.message } : { borradas: data.length });
  }

  if (accion === 'completar') return completar(admin, user, res);
  if (accion === 'analizar') return analizar(admin, user, req.body?.lotes || [], res);

  // Ritmo configurado por el usuario (Admin → Ritmo de descarga)
  const { data: rc } = await admin.from('arkaphoto_config').select('cola_concurrencia,cola_pausa_ms,cola_tanda').eq('user_id', user.id).maybeSingle();
  const conc = Math.min(Math.max(Number(rc?.cola_concurrencia) || 1, 1), CONCURRENCIA);
  const pausa = Math.min(Math.max(Number(rc?.cola_pausa_ms) || 0, 0), 60000);
  const n = Math.min(Math.max(Number(req.body?.n) || Number(rc?.cola_tanda) || 12, 1), 48);
  const inicio = Date.now();
  const dormir = ms => new Promise(r => setTimeout(r, ms));
  // Toma pendientes (y "procesando" huérfanas de más de 5 min) y las marca como procesando
  const { data: lote } = await admin.from('arkaphoto_cola').select('*').eq('user_id', user.id)
    .or(`estado.eq.pendiente,and(estado.eq.procesando,procesado_en.lt.${new Date(Date.now() - 300000).toISOString()})`)
    .order('id').limit(n);
  if (!lote?.length) return res.status(200).json({ procesadas: 0, fin: true });
  const ids = lote.map(x => x.id);
  await admin.from('arkaphoto_cola').update({ estado: 'procesando', procesado_en: new Date().toISOString() }).in('id', ids);

  // Existencia previa en el sistema
  const lotesQ = [...new Set(lote.map(x => x.lote))];
  const { data: existentes } = await admin.from('arkaphoto_imagenes').select('lote,seq').eq('user_id', user.id).in('lote', lotesQ);
  const ya = new Set((existentes || []).map(r => `${r.lote}-${r.seq}`));

  const cola = lote.slice(); const res_ = { traidas: 0, existe: 0, error: 0, noexiste: 0, extAlterna: 0, resondeados: 0, encoladas: 0 }; const clasificados = new Set(), resondeados = new Set(), validados = new Set();
  const marcar = (fila, campos) => admin.from('arkaphoto_cola').update({ ...campos, procesado_en: new Date().toISOString() }).eq('id', fila.id);
  const cab = { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' };
  // Si una foto apareció con la otra extensión, el tamaño sondeado del lote pudo quedar corto: se vuelve a sondear con ambas extensiones y se encola lo nuevo.
  const resondear = async t => {
    if (resondeados.has(t.lote)) return; resondeados.add(t.lote);
    const base = t.url.slice(0, t.url.lastIndexOf('/'));
    const [{ data: imgs }, { data: enCola }] = await Promise.all([
      admin.from('arkaphoto_imagenes').select('seq').eq('user_id', user.id).eq('lote', t.lote),
      admin.from('arkaphoto_cola').select('seq').eq('user_id', user.id).eq('lote', t.lote)]);
    const conocidas = new Set([...(imgs || []).map(r => r.seq), ...(enCola || []).map(r => r.seq)]);
    const { tamano } = await sondearTamano(base, t.lote, t.ext, pow2(Math.max(1, ...conocidas)));
    await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote: t.lote, tamano, sondeado_en: new Date().toISOString() }, { onConflict: 'user_id,lote' });
    const nuevas = []; for (let i = 1; i <= tamano; i++) if (!conocidas.has(i)) nuevas.push({ user_id: user.id, lote: t.lote, seq: i, ext: t.ext, nombre: `${t.lote}-${i}.${t.ext}`, url: `${base}/${t.lote}-${i}.${t.ext}`, origen_archivo: 'resondeo', clasif_id: t.clasif_id || null });
    if (nuevas.length) { const { data: ins } = await admin.from('arkaphoto_cola').upsert(nuevas, { onConflict: 'user_id,lote,seq', ignoreDuplicates: true }).select('id'); res_.encoladas += ins?.length || 0; }
    res_.resondeados++;
  };
  const worker = async () => {
    while (cola.length) {
      if (Date.now() - inicio > PRESUPUESTO_MS) { const resto = cola.splice(0); if (resto.length) await admin.from('arkaphoto_cola').update({ estado: 'pendiente' }).in('id', resto.map(x => x.id)); return; }
      const t = cola.shift();
      try {
        if (ya.has(`${t.lote}-${t.seq}`)) { await marcar(t, { estado: 'existe' }); res_.existe++; continue; }
        const u = new URL(t.url);
        if (u.protocol !== 'https:' || !hostPermitido(u.hostname)) throw Object.assign(new Error('host no permitido'), { fatal: true });
        // Preferencia PNG > JPG independientemente de la extensión listada; el lote puede mezclar ambas
        const { r, ext: e } = await bajarSeq(t.url, t.ext, cab);
        if (r.ok && e !== t.ext) { Object.assign(t, { ext: e, url: conExt(t.url, e), nombre: `${t.lote}-${t.seq}.${e}` }); await marcar(t, { ext: e, url: t.url, nombre: t.nombre }); res_.extAlterna++; await resondear(t); }
        if (r.status === 404) {
          await marcar(t, { estado: 'error', http_status: 404, error: 'no existe en la ruta (ni .png ni .jpg): no recuperable desde la web', intentos: MAX_INTENTOS }); res_.noexiste++;
          if (!validados.has(t.lote)) { validados.add(t.lote); await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote: t.lote, validado_en: new Date().toISOString() }, { onConflict: 'user_id,lote' }); }
          continue;
        }
        if (r.status === 429 || r.status === 403) { // el origen nos frena: devolver a pendiente y cortar la tanda
          await marcar(t, { estado: 'pendiente', http_status: r.status, error: `HTTP ${r.status} (origen frenó)`, intentos: t.intentos });
          res_.frenado = r.status; const resto = cola.splice(0); if (resto.length) await admin.from('arkaphoto_cola').update({ estado: 'pendiente' }).in('id', resto.map(x => x.id)); return;
        }
        if (!r.ok) { await marcar(t, { estado: 'error', http_status: r.status, error: `HTTP ${r.status}`, intentos: t.intentos + 1 }); res_.error++; continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) { await marcar(t, { estado: 'error', http_status: 413, error: 'archivo > 50 MB', intentos: MAX_INTENTOS }); res_.error++; continue; }
        const ruta = `${user.id}/${t.lote}/${t.nombre}`;
        const up = await admin.storage.from('arkaphoto').upload(ruta, buf, { contentType: t.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
        if (up.error) throw new Error(up.error.message);
        const { ancho, alto } = dimensiones(buf);
        const ins = await admin.from('arkaphoto_imagenes').upsert(
          { user_id: user.id, lote: t.lote, seq: t.seq, ext: t.ext, nombre: t.nombre, ruta, bytes: buf.length, origen: 'traida', url_origen: t.url, ancho, alto },
          { onConflict: 'user_id,lote,seq' });
        if (ins.error) throw new Error(ins.error.message);
        if (t.clasif_id && !clasificados.has(t.lote)) {
          clasificados.add(t.lote);
          await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote: t.lote, clasif_id: t.clasif_id, actualizado: new Date().toISOString() }, { onConflict: 'user_id,lote' });
        }
        await marcar(t, { estado: 'traida', http_status: 200, bytes: buf.length, error: null }); res_.traidas++;
        if (pausa) await dormir(pausa + Math.floor(Math.random() * pausa * 0.4));
      } catch (e) {
        const intentos = t.intentos + 1;
        await marcar(t, { estado: e.fatal || intentos >= MAX_INTENTOS ? 'error' : 'pendiente', error: String(e.message || e).slice(0, 200), intentos });
        res_.error++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(conc, lote.length) }, worker));
  const { count } = await admin.from('arkaphoto_cola').select('id', { count: 'exact', head: true }).eq('user_id', user.id).eq('estado', 'pendiente');
  res.status(200).json({ procesadas: lote.length, ...res_, pendientes: count ?? 0, fin: (count ?? 0) === 0 && !res_.frenado, ms: Date.now() - inicio, ritmo: { conc, pausa, n } });
}

// ---- Completar lotes: para cada lote presente en la cola, sondea su tamaño en la base de su propia URL
//      (32 → 16 → 8 → 4 → 2; nunca por debajo del mayor seq conocido) y encola las posiciones que falten.
async function completar(admin, user, res) {
  const inicio = Date.now();
  const { data: filas } = await admin.from('arkaphoto_cola').select('lote,seq,ext,url,clasif_id').eq('user_id', user.id).order('id').limit(5000);
  if (!filas?.length) return res.status(200).json({ lotes: 0, encoladas: 0, restantes: 0, fin: true });
  const porLote = new Map();
  for (const f of filas) { if (!porLote.has(f.lote)) porLote.set(f.lote, { ext: f.ext, base: f.url.slice(0, f.url.lastIndexOf('/')), seqs: new Set(), clasif_id: f.clasif_id || null }); const L = porLote.get(f.lote); L.seqs.add(f.seq); if (!L.clasif_id && f.clasif_id) L.clasif_id = f.clasif_id; }
  const keys = [...porLote.keys()];
  const { data: meta } = await admin.from('arkaphoto_lotes').select('lote,sondeado_en').eq('user_id', user.id).in('lote', keys);
  const hechos = new Set((meta || []).filter(m => m.sondeado_en).map(m => m.lote));
  const pendientes = keys.filter(k => !hechos.has(k));
  const { data: imgs } = await admin.from('arkaphoto_imagenes').select('lote,seq').eq('user_id', user.id).in('lote', pendientes.slice(0, 200));
  (imgs || []).forEach(r => porLote.get(r.lote)?.seqs.add(r.seq));
  let lotesHechos = 0, encoladas = 0;
  for (const k of pendientes) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break;
    const L = porLote.get(k); let host;
    try { const u = new URL(L.base); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch { continue; }
    if (!hostPermitido(host)) continue;
    const minimo = pow2(Math.max(1, ...L.seqs));
    const { tamano } = await sondearTamano(L.base, k, L.ext, minimo);
    await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote: k, tamano, sondeado_en: new Date().toISOString() }, { onConflict: 'user_id,lote' });
    const nuevas = [];
    for (let i = 1; i <= tamano; i++) if (!L.seqs.has(i)) nuevas.push({ user_id: user.id, lote: k, seq: i, ext: L.ext, nombre: `${k}-${i}.${L.ext}`, url: `${L.base}/${k}-${i}.${L.ext}`, origen_archivo: 'completar', clasif_id: L.clasif_id });
    if (nuevas.length) { const { data: ins } = await admin.from('arkaphoto_cola').upsert(nuevas, { onConflict: 'user_id,lote,seq', ignoreDuplicates: true }).select('id'); encoladas += ins?.length || 0; }
    lotesHechos++;
  }
  res.status(200).json({ lotes: lotesHechos, encoladas, restantes: pendientes.length - lotesHechos, fin: pendientes.length - lotesHechos === 0, ms: Date.now() - inicio });
}

// ---- Analizar: para cada lote recibido {lote, ext, base, seqs}, sondea el tamaño en su base (o usa el guardado)
//      y devuelve qué posiciones faltan por traer y cuáles ya existen. No encola; el navegador encola con el resultado.
async function analizar(admin, user, lotesIn, res) {
  const inicio = Date.now();
  const lista = (Array.isArray(lotesIn) ? lotesIn : []).slice(0, 80).filter(l => /^\d+-[0-9a-f]{32}$/.test(l.lote || '') && ['jpg', 'jpeg', 'png'].includes(l.ext));
  if (!lista.length) return res.status(200).json({ lotes: [] });
  const keys = lista.map(l => l.lote);
  const [{ data: meta }, { data: imgs }, { data: enCola }] = await Promise.all([
    admin.from('arkaphoto_lotes').select('lote,tamano,sondeado_en').eq('user_id', user.id).in('lote', keys),
    admin.from('arkaphoto_imagenes').select('lote,seq').eq('user_id', user.id).in('lote', keys),
    admin.from('arkaphoto_cola').select('lote,seq,estado').eq('user_id', user.id).in('lote', keys)
  ]);
  const metaM = new Map((meta || []).map(m => [m.lote, m]));
  const imgM = new Map(), colaM = new Map();
  (imgs || []).forEach(r => { if (!imgM.has(r.lote)) imgM.set(r.lote, new Set()); imgM.get(r.lote).add(r.seq); });
  (enCola || []).forEach(r => { if (!colaM.has(r.lote)) colaM.set(r.lote, new Map()); colaM.get(r.lote).set(r.seq, r.estado); });
  const out = []; const pendientes = lista.slice();
  const worker = async () => {
    while (pendientes.length) {
      const L = pendientes.shift(); let host;
      try { const u = new URL(L.base); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch { out.push({ lote: L.lote, error: 'base inválida' }); continue; }
      if (!hostPermitido(host)) { out.push({ lote: L.lote, error: 'host no permitido' }); continue; }
      const conocidas = new Set([...(L.seqs || []).map(Number), ...(imgM.get(L.lote) || []), ...(colaM.get(L.lote)?.keys() || [])]);
      const minimo = pow2(Math.max(1, ...conocidas)); const m = metaM.get(L.lote);
      let tamano = m?.sondeado_en && m.tamano >= minimo ? m.tamano : null;
      if (!tamano && Date.now() - inicio < PRESUPUESTO_MS) {
        ({ tamano } = await sondearTamano(L.base, L.lote, L.ext, minimo));
        await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote: L.lote, tamano, sondeado_en: new Date().toISOString() }, { onConflict: 'user_id,lote' });
      }
      if (!tamano) { out.push({ lote: L.lote, pendiente: true }); continue; }
      const existen = [...(imgM.get(L.lote) || [])], encoladas = [...(colaM.get(L.lote)?.keys() || [])];
      const faltan = []; for (let i = 1; i <= tamano; i++) if (!imgM.get(L.lote)?.has(i) && !colaM.get(L.lote)?.has(i)) faltan.push(i);
      out.push({ lote: L.lote, tamano, existen, encoladas, faltan });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, lista.length) }, worker));
  res.status(200).json({ lotes: out, ms: Date.now() - inicio });
}
