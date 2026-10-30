// POST /api/mejorar { lote, seqs?:[n], aplicar:boolean }
// Para las fotos del lote guardadas en JPG, comprueba si el origen tiene la misma posición en PNG (mejor calidad).
//   aplicar=false → solo reporta { revisadas, disponibles:[seq] }
//   aplicar=true  → además baja el PNG, reemplaza el objeto en Storage y actualiza arkaphoto_imagenes → { mejoradas:[seq] }
// Se usa al terminar una subida (automático) y desde Histórico → Validar lote (manual).
import { createClient } from '@supabase/supabase-js';
import { conVersion } from './_version.js';
import { dimensiones } from './_dims.js';
import { hostPermitido, existeSeq, UA } from './_origen.js';

export const config = { maxDuration: 60 };
const RX_LOTE = /^\d+-[0-9a-f]{32}$/;
const MAX_BYTES = 50 * 1024 * 1024;
const PRESUPUESTO_MS = 45000;

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

  const lote = String(req.body?.lote || ''), aplicar = !!req.body?.aplicar;
  if (!RX_LOTE.test(lote)) return res.status(400).json({ error: 'Lote inválido' });
  const { data: cfg } = await admin.from('arkaphoto_config').select('ruta_publica,cola_pausa_ms').eq('user_id', user.id).maybeSingle();
  const base = (cfg?.ruta_publica || '').replace(/\/+$/, '');
  let host; try { const u = new URL(base); if (u.protocol !== 'https:') throw 0; host = u.hostname; } catch { return res.status(400).json({ error: 'Configura la ruta pública (https) en Admin' }); }
  if (!hostPermitido(host)) return res.status(403).json({ error: `El host ${host} no está en ALLOWED_FETCH_HOSTS` });
  const pausa = Math.min(Math.max(Number(cfg?.cola_pausa_ms) || 0, 0), 60000);
  const dormir = ms => new Promise(r => setTimeout(r, ms));

  let q = admin.from('arkaphoto_imagenes').select('id,seq,ext,ruta').eq('user_id', user.id).eq('lote', lote).neq('ext', 'png').order('seq');
  if (Array.isArray(req.body?.seqs) && req.body.seqs.length) q = q.in('seq', req.body.seqs.map(Number).filter(n => n >= 1 && n <= 32));
  const { data: filas, error } = await q;
  if (error) return res.status(500).json({ error: error.message });

  const inicio = Date.now(); const disponibles = [], mejoradas = [], errores = []; let revisadas = 0, agotado = false;
  for (const f of filas || []) {
    if (Date.now() - inicio > PRESUPUESTO_MS) { agotado = true; break; }
    revisadas++;
    const e = await existeSeq(base, lote, f.seq, 'png'); // prueba .png primero
    if (e !== 'png') continue;
    disponibles.push(f.seq);
    if (!aplicar) continue;
    try {
      const url = `${base}/${lote}-${f.seq}.png`;
      const r = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': UA, Accept: 'image/*,*/*;q=0.8' } });
      if (!r.ok) { errores.push(`${f.seq}: HTTP ${r.status}`); continue; }
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length > MAX_BYTES) { errores.push(`${f.seq}: > 50 MB`); continue; }
      const nombre = `${lote}-${f.seq}.png`, ruta = `${user.id}/${lote}/${nombre}`;
      const up = await admin.storage.from('arkaphoto').upload(ruta, buf, { contentType: 'image/png', upsert: true });
      if (up.error) { errores.push(`${f.seq}: ${up.error.message}`); continue; }
      const { ancho, alto } = dimensiones(buf);
      const upd = await admin.from('arkaphoto_imagenes').update({ ext: 'png', nombre, ruta, bytes: buf.length, ancho, alto, url_origen: url }).eq('id', f.id);
      if (upd.error) { errores.push(`${f.seq}: ${upd.error.message}`); continue; }
      if (f.ruta && f.ruta !== ruta) await admin.storage.from('arkaphoto').remove([f.ruta]);
      mejoradas.push(f.seq);
      if (pausa) await dormir(pausa);
    } catch (e) { errores.push(`${f.seq}: ${String(e.message || e).slice(0, 120)}`); }
  }
  res.status(200).json({ lote, revisadas, disponibles, mejoradas, errores, agotado, ms: Date.now() - inicio });
}
