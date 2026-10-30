// POST /api/sondear { lotes:[{lote, ext, minimo}] }
// Determina el tamaño de cada lote (potencia de 2) sondeando la ruta pública: 32 → 16 → 8 → 4 → 2; si nada existe, 1.
// Nunca baja de `minimo` (la potencia de 2 ≥ al mayor número ya subido). Guarda tamano/sondeado_en en arkaphoto_lotes.
import { createClient } from '@supabase/supabase-js';
import { conVersion } from './_version.js';
import { ESCALA, hostPermitido, sondearTamano } from './_origen.js';

export const config = { maxDuration: 60 };
const RX_LOTE = /^\d+-[0-9a-f]{32}$/;

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

  const { data: cfg } = await admin.from('arkaphoto_config').select('ruta_publica').eq('user_id', user.id).maybeSingle();
  const base = (cfg?.ruta_publica || '').replace(/\/+$/, '');
  let host;
  try { const u = new URL(base); if (u.protocol !== 'https:') throw 0; host = u.hostname; }
  catch { return res.status(400).json({ error: 'Configura la ruta pública (https) en Admin' }); }
  if (!hostPermitido(host)) return res.status(403).json({ error: `El host ${host} no está en ALLOWED_FETCH_HOSTS` });

  const lotes = Array.isArray(req.body?.lotes) ? req.body.lotes.slice(0, 32) : [];
  const resultados = [];
  for (const it of lotes) {
    const lote = String(it.lote || ''), ext = String(it.ext || '').toLowerCase();
    const minimo = ESCALA.includes(Number(it.minimo)) ? Number(it.minimo) : 1;
    if (!RX_LOTE.test(lote) || !['jpg', 'jpeg', 'png'].includes(ext)) { resultados.push({ lote, error: 'parámetros inválidos' }); continue; }
    const { tamano, probadas, extHallada } = await sondearTamano(base, lote, ext, minimo);
    const { error } = await admin.from('arkaphoto_lotes').upsert({ user_id: user.id, lote, tamano, sondeado_en: new Date().toISOString() }, { onConflict: 'user_id,lote' });
    resultados.push({ lote, tamano, probadas, extAlterna: !!extHallada && extHallada !== ext, guardado: !error, error: error?.message });
  }
  res.status(200).json({ resultados });
}
