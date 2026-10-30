// Utilidades compartidas de autenticación (no es un endpoint: Vercel ignora archivos que empiezan con "_").
import { createClient } from '@supabase/supabase-js';
import { createHash, randomInt } from 'node:crypto';

export const CODE_LEN = 8;
export const CODE_TTL_MIN = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_COOLDOWN_S = 45;

export function admin() {
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function normEmail(e) {
  return String(e || '').trim().toLowerCase();
}
export function emailValido(e) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
}

// Lista blanca opcional: ALLOWED_EMAILS="a@x.com,b@y.com" y/o ALLOWED_EMAIL_DOMAINS="hixsa.com,elothe.dev"
export function emailPermitido(e) {
  const emails = (process.env.ALLOWED_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const dominios = (process.env.ALLOWED_EMAIL_DOMAINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!emails.length && !dominios.length) return true;
  if (emails.includes(e)) return true;
  const dom = e.split('@')[1] || '';
  return dominios.includes(dom);
}

export function generarCodigo() {
  return String(randomInt(0, 10 ** CODE_LEN)).padStart(CODE_LEN, '0');
}

export function hashCodigo(email, code) {
  const secret = process.env.OTP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return createHash('sha256').update(`${email}:${code}:${secret}`).digest('hex');
}

export async function enviarResend({ to, code }) {
  const key = process.env.RESEND_API_KEY, from = process.env.RESEND_FROM;
  if (!key || !from) throw new Error('Faltan RESEND_API_KEY / RESEND_FROM');
  const app = process.env.APP_NAME || 'ARKAPHOTO';
  const html = `
<div style="background:#0f1013;padding:32px 16px;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#e8e6df">
  <div style="max-width:440px;margin:0 auto;background:#17181c;border:1px solid #2a2c33;border-radius:12px;padding:28px">
    <div style="font-size:20px;font-weight:700;letter-spacing:-.01em">elothe<span style="color:#9a968c">.dev</span></div>
    <div style="font-family:Consolas,Menlo,monospace;font-size:11px;letter-spacing:.14em;color:#9a968c;margin:6px 0 22px">PORTAL DE APLICACIONES · ${app}</div>
    <p style="margin:0 0 14px;font-size:15px">Tu código de acceso:</p>
    <div style="font-family:Consolas,Menlo,monospace;font-size:34px;font-weight:600;letter-spacing:.28em;color:#f2c14e;background:#0f1013;border:1px solid #2a2c33;border-radius:8px;padding:16px;text-align:center">${code}</div>
    <p style="margin:18px 0 0;font-size:13px;color:#9a968c">Caduca en ${CODE_TTL_MIN} minutos. Si no lo pediste, ignora este correo.</p>
  </div>
</div>`;
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [to], subject: `${code} es tu código de ${app}`, html, text: `Tu código de ${app}: ${code} (caduca en ${CODE_TTL_MIN} min)` })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status}: ${t.slice(0, 200)}`);
  }
}
