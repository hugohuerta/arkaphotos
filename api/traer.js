// POST /api/traer  { lote, ext, seqs:[n,...] }
// Jala cada faltante desde la ruta pública del usuario y la guarda en el bucket.
// Corre en servidor para evitar CORS y para usar la service role (nunca va al navegador).
import { createClient } from '@supabase/supabase-js';

export const config = { maxDuration: 60 };

const RX_LOTE = /^\d+-[0-9a-f]{32}$/;
const MAX_BYTES = 50 * 1024 * 1024;
const CONCURRENCIA = 4;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return res.status(500).json({ error: 'Faltan variables de Supabase' });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sin sesión' });

  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const { data: { user }, error: uerr } = await admin.auth.getUser(token);
  if (uerr || !user) return res.status(401).json({ error: 'Sesión inválida' });

  const { lote, ext, seqs } = req.body || {};
  if (!RX_LOTE.test(lote || '') || !['jpg','jpeg','png'].includes(ext) || !Array.isArray(seqs) || !seqs.length)
    return res.status(400).json({ error: 'Parámetros inválidos' });
  const lista = [...new Set(seqs.map(Number))].filter(n => Number.isInteger(n) && n >= 1 && n <= 32);

  const { data: cfg } = await admin.from('arkaphoto_config').select('ruta_publica').eq('user_id', user.id).maybeSingle();
  const base = (cfg?.ruta_publica || '').replace(/\/+$/, '');
  if (!/^https?:\/\//.test(base)) return res.status(400).json({ error: 'Configura la ruta pública primero' });

  const resultados = [];
  const cola = lista.slice();
  const worker = async () => {
    while (cola.length) {
      const seq = cola.shift();
      const nombre = `${lote}-${seq}.${ext}`;
      const url = `${base}/${nombre}`;
      try {
        const r = await fetch(url, { redirect: 'follow' });
        if (!r.ok) { resultados.push({ seq, ok: false, status: r.status }); continue; }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > MAX_BYTES) { resultados.push({ seq, ok: false, status: 413 }); continue; }
        const tipo = ext === 'png' ? 'image/png' : 'image/jpeg';
        const ruta = `${user.id}/${lote}/${nombre}`;
        const up = await admin.storage.from('arkaphoto').upload(ruta, buf, { contentType: tipo, upsert: true });
        if (up.error) { resultados.push({ seq, ok: false, status: 500, error: up.error.message }); continue; }
        const ins = await admin.from('arkaphoto_imagenes').upsert(
          { user_id: user.id, lote, seq, ext, nombre, ruta, bytes: buf.length, origen: 'traida' },
          { onConflict: 'user_id,lote,seq' });
        if (ins.error) { resultados.push({ seq, ok: false, status: 500, error: ins.error.message }); continue; }
        resultados.push({ seq, ok: true, bytes: buf.length, ruta });
      } catch (e) {
        resultados.push({ seq, ok: false, status: 0, error: String(e.message || e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, lista.length) }, worker));
  resultados.sort((a, b) => a.seq - b.seq);
  res.status(200).json({ lote, resultados });
}
