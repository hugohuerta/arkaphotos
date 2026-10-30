// Utilidades compartidas para hablar con el origen (ruta pública / R2 de photoai).
// Un lote puede mezclar extensiones (.jpg y .png): toda comprobación prueba la extensión
// esperada y, si responde 404, la alterna.
export const ESCALA = [32, 16, 8, 4, 2];
export const pow2 = n => { let p = 1; while (p < n) p *= 2; return Math.min(32, p); };
export const alterna = ext => (ext === 'png' ? 'jpg' : 'png');
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export function hostPermitido(host) {
  const hosts = (process.env.ALLOWED_FETCH_HOSTS || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean);
  return !hosts.length || hosts.some(h => host === h || host.endsWith('.' + h));
}

// Cambia la extensión del último segmento de una URL
export const conExt = (url, ext) => url.replace(/\.(jpe?g|png)$/i, '.' + ext);

async function existe(url) {
  try {
    let r = await fetch(url, { method: 'HEAD', redirect: 'follow', headers: { 'User-Agent': UA } });
    if (r.status === 405 || r.status === 501) r = await fetch(url, { method: 'GET', headers: { Range: 'bytes=0-0', 'User-Agent': UA }, redirect: 'follow' });
    return r.ok;
  } catch { return false; }
}

// ¿Existe la posición seq del lote en base? Devuelve la extensión con la que respondió o null.
export async function existeSeq(base, lote, seq, ext) {
  if (await existe(`${base}/${lote}-${seq}.${ext}`)) return ext;
  const a = alterna(ext);
  if (await existe(`${base}/${lote}-${seq}.${a}`)) return a;
  return null;
}

// Tamaño del lote (potencia de 2): 32 → 16 → 8 → 4 → 2, nunca por debajo de `minimo`; prueba ambas extensiones en cada paso.
export async function sondearTamano(base, lote, ext, minimo) {
  let tamano = minimo; const probadas = []; let extHallada = null;
  for (const t of ESCALA) {
    if (t <= minimo) break;
    probadas.push(t);
    const e = await existeSeq(base, lote, t, ext);
    if (e) { tamano = t; extHallada = e; break; }
  }
  return { tamano, probadas, extHallada };
}
