// Entrega al navegador las claves públicas de Supabase (la anon key es pública por diseño; RLS protege los datos).
import { conVersion } from './_version.js';

export default function handler(req, res) {
  conVersion(res);
  const url = process.env.SUPABASE_URL, anonKey = process.env.SUPABASE_ANON_KEY;
  if (!url || !anonKey) return res.status(500).json({ error: 'Faltan SUPABASE_URL / SUPABASE_ANON_KEY en Vercel' });
  res.setHeader('Cache-Control', 'public, max-age=300');
  res.status(200).json({ url, anonKey });
}
