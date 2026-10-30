// GET /api/version → { app, version, migracion_esperada, migracion_aplicada }
// Sin sesión: no expone nada sensible. migracion_aplicada sale de arkaphoto_migraciones con service role.
import { createClient } from '@supabase/supabase-js';
import { APP, VERSION, MIGRACION_ESPERADA, conVersion } from './_version.js';

export default async function handler(req, res) {
  conVersion(res);
  res.setHeader('Cache-Control', 'no-store');
  let aplicada = null;
  try {
    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
    const { data } = await sb.from('arkaphoto_migraciones').select('num').order('num', { ascending: false }).limit(1).maybeSingle();
    aplicada = data?.num ?? 0;
  } catch { aplicada = null; }
  res.status(200).json({ app: APP, version: VERSION, migracion_esperada: MIGRACION_ESPERADA, migracion_aplicada: aplicada });
}
