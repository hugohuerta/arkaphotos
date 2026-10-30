// POST /api/auth/send { email } → genera código de 8 dígitos, lo guarda hasheado y lo manda por Resend.
import { admin, normEmail, emailValido, emailPermitido, generarCodigo, hashCodigo, enviarResend, CODE_TTL_MIN, RESEND_COOLDOWN_S } from '../_auth.js';
import { conVersion } from '../_version.js';

export default async function handler(req, res) {
  conVersion(res);
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST' });
  const email = normEmail(req.body?.email);
  if (!emailValido(email)) return res.status(400).json({ error: 'Correo inválido' });
  // Correo fuera de la lista blanca: misma respuesta que un envío real, sin enviar nada (no revela qué correos existen)
  if (!emailPermitido(email)) return res.status(200).json({ ok: true, ttl: CODE_TTL_MIN, cooldown: RESEND_COOLDOWN_S });

  try {
    const sb = admin();
    const { data: prev } = await sb.from('arkaphoto_otp').select('sent_at').eq('email', email).maybeSingle();
    if (prev) {
      const espera = RESEND_COOLDOWN_S - (Date.now() - new Date(prev.sent_at).getTime()) / 1000;
      if (espera > 0) return res.status(429).json({ error: `Espera ${Math.ceil(espera)} s para pedir otro código`, retry: Math.ceil(espera) });
    }
    const code = generarCodigo();
    const { error } = await sb.from('arkaphoto_otp').upsert({
      email, code_hash: hashCodigo(email, code),
      expires_at: new Date(Date.now() + CODE_TTL_MIN * 60000).toISOString(),
      attempts: 0, sent_at: new Date().toISOString()
    });
    if (error) throw new Error(error.message);
    await enviarResend({ to: email, code });
    res.status(200).json({ ok: true, ttl: CODE_TTL_MIN, cooldown: RESEND_COOLDOWN_S });
  } catch (e) {
    console.error('auth/send', e);
    res.status(500).json({ error: 'No se pudo enviar el código' });
  }
}
