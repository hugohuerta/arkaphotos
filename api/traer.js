// POST /api/traer
//   { lote, ext, seqs:[n,...] }   → faltantes de un lote, desde la ruta pública configurada
//   { urls:[...] }                → lista explícita de URLs (sección "Carga de URL")
// Corre en servidor para evitar CORS y usar la service role (nunca va al navegador).
// Antes de descargar comprueba que la posición no exista ya en arkaphoto_imagenes.
import { createClient } from '@supabase/supabase-js';
import { conVersion } from './_version.js';
import { dimensiones } from './_dims.js';
import { hostPermitido, alterna, conExt, UA } from './_origen.js';

export const config = { maxDuration: 60 };

const RX_LOTE = /^\d+-[0-9a-f]{32}$/;
const RX_NOMBRE = /^(\d+)-([0-9a-fA-F]{32})-(\d{1,2})\.(jpe?g|png)$/i;
const MAX_BYTES = 50 * 1024 * 1024;
const CONCURRENCIA = 4;
const MAX_URLS = 64;

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

  // ---- Construir la lista de trabajo: { url, lote, seq, ext, nombre }
  const trabajo = [];
  const body = req.body || {};
  if (Array.isArray(body.urls)) {
    const vistos = new Set();
    for (const raw of body.urls.slice(0, MAX_URLS)) {
      const item = { url: String(raw || '').trim() };
      try {
        const u = new URL(item.url);
        if (u.protocol !== 'https:') throw new Error('solo https');
        if (!hostPermitido(u.hostname)) throw new Error('host no permitido');
        const nombre = decodeURIComponent(u.pathname.split('/').pop() || '');
        const m = nombre.match(RX_NOMBRE);
        if (!m) throw new Error('nombre no reconocido');
        Object.assign(item, { lote: `${m[1]}-${m[2].toLowerCase()}`, seq: parseInt(m[3], 10), ext: m[4].toLowerCase() });
        item.nombre = `${item.lote}-${item.seq}.${item.ext}`;
        if (item.seq < 1 || item.seq > 32) throw new Error('secuencia fuera de 1–32');
        const k = `${item.lote}-${item.seq}`;
        if (vistos.has(k)) throw new Error('repetida en la lista');
        vistos.add(k);
        trabajo.push(item);
      } catch (e) { trabajo.push({ ...item, ok: false, status: 'omitida', error: e.message }); }
    }
  } else {
    const { lote, ext, seqs } = body;
    if (!RX_LOTE.test(lote || '') || !['jpg', 'jpeg', 'png'].includes(ext) || !Array.isArray(seqs) || !seqs.length)
      return res.status(400).json({ error: 'Parámetros inválidos' });
    const { data: cfg } = await admin.from('arkaphoto_config').select('ruta_publica').eq('user_id', user.id).maybeSingle();
    const base = (cfg?.ruta_publica || '').replace(/\/+$/, '');
    let host;
    try { const u = new URL(base); if (u.protocol !== 'https:') throw 0; host = u.hostname; }
    catch { return res.status(400).json({ error: 'La ruta pública debe ser https://' }); }
    if (!hostPermitido(host)) return res.status(403).json({ error: `El host ${host} no está en ALLOWED_FETCH_HOSTS` });
    for (const n of [...new Set(seqs.map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= 32)) {
      const nombre = `${lote}-${n}.${ext}`;
      trabajo.push({ url: `${base}/${nombre}`, lote, seq: n, ext, nombre });
    }
  }

  // ---- Omitir lo que ya existe en el sistema
  const pendientes = trabajo.filter(t => t.ok !== false);
  if (pendientes.length) {
    const lotesQ = [...new Set(pendientes.map(t => t.lote))];
    const { data: existentes } = await admin.from('arkaphoto_imagenes').select('lote,seq').eq('user_id', user.id).in('lote', lotesQ);
    const ya = new Set((existentes || []).map(r => `${r.lote}-${r.seq}`));
    for (const t of pendientes) if (ya.has(`${t.lote}-${t.seq}`)) Object.assign(t, { ok: false, status: 'existe' });
  }

  // ---- Descargar con concurrencia limitada
  const cola = trabajo.filter(t => t.ok !== false);
  const worker = async () => {
    while (cola.length) {
      const t = cola.shift();
      try {
        let r = await fetch(t.url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } });
        if (r.status === 404) { // el lote puede mezclar .jpg y .png: probar la otra extensión antes de darla por inexistente
          const a = alterna(t.ext), ua = conExt(t.url, a);
          const ra = await fetch(ua, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } });
          if (ra.ok) { r = ra; Object.assign(t, { ext: a, url: ua, nombre: `${t.lote}-${t.seq}.${a}`, extAlterna: true }); }
        }
        if (!r.ok) { Object.assign(t, { ok: false, status: r.status }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) { Object.assign(t, { ok: false, status: 413 }); continue; }
        const ruta = `${user.id}/${t.lote}/${t.nombre}`;
        const up = await admin.storage.from('arkaphoto').upload(ruta, buf, { contentType: t.ext === 'png' ? 'image/png' : 'image/jpeg', upsert: true });
        if (up.error) { Object.assign(t, { ok: false, status: 500, error: up.error.message }); continue; }
        const { ancho, alto } = dimensiones(buf);
        const ins = await admin.from('arkaphoto_imagenes').upsert(
          { user_id: user.id, lote: t.lote, seq: t.seq, ext: t.ext, nombre: t.nombre, ruta, bytes: buf.length, origen: 'traida', url_origen: t.url, ancho, alto },
          { onConflict: 'user_id,lote,seq' });
        if (ins.error) { Object.assign(t, { ok: false, status: 500, error: ins.error.message }); continue; }
        Object.assign(t, { ok: true, bytes: buf.length, ruta });
      } catch (e) { Object.assign(t, { ok: false, status: 0, error: String(e.message || e) }); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, Math.max(cola.length, 1)) }, worker));

  const resultados = trabajo.map(({ url, lote, seq, nombre, ok, status, bytes, error, extAlterna }) => ({ url, lote, seq, nombre, ok: !!ok, status, bytes, error, extAlterna: !!extAlterna }));
  res.status(200).json({ resultados, traidas: resultados.filter(r => r.ok).length });
}
