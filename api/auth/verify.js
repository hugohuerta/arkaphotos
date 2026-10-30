// POST /api/auth/verify { email, code } → valida el código y devuelve un token_hash de Supabase
// con el que el navegador abre sesión (supabase.auth.verifyOtp). El código se consume al primer acierto.
import { admin, normEmail, hashCodigo, MAX_ATTEMPTS, CODE_LEN } from '../_auth.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  const email = normEmail(req.body?.email);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!email || code.length !== CODE_LEN) return res.status(400).json({ error: `El código tiene ${CODE_LEN} dígitos` });

  try {
    const sb = admin();
    const { data: row } = await sb.from('arkaphoto_otp').select('*').eq('email', email).maybeSingle();
    if (!row) return res.status(400).json({ error: 'Pide un código primero' });
    if (new Date(row.expires_at) < new Date()) { await sb.from('arkaphoto_otp').delete().eq('email', email); return res.status(400).json({ error: 'El código venció; pide uno nuevo' }); }
    if (row.attempts >= MAX_ATTEMPTS) { await sb.from('arkaphoto_otp').delete().eq('email', email); return res.status(429).json({ error: 'Demasiados intentos; pide un código nuevo' }); }
    if (row.code_hash !== hashCodigo(email, code)) {
      await sb.from('arkaphoto_otp').update({ attempts: row.attempts + 1 }).eq('email', email);
      return res.status(401).json({ error: `Código incorrecto (${MAX_ATTEMPTS - row.attempts - 1} intentos restantes)` });
    }
    await sb.from('arkaphoto_otp').delete().eq('email', email);

    // Usuario en Supabase Auth: crearlo si es la primera vez
    let link = await sb.auth.admin.generateLink({ type: 'magiclink', email });
    if (link.error && /not found|does not exist/i.test(link.error.message)) {
      const cu = await sb.auth.admin.createUser({ email, email_confirm: true });
      if (cu.error) throw new Error(cu.error.message);
      link = await sb.auth.admin.generateLink({ type: 'magiclink', email });
    }
    if (link.error) throw new Error(link.error.message);
    res.status(200).json({ ok: true, token_hash: link.data.properties.hashed_token });
  } catch (e) {
    console.error('auth/verify', e);
    res.status(500).json({ error: 'No se pudo validar el código' });
  }
}
