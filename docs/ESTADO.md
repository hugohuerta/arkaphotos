# ESTADO · ARKAPHOTO

Sesión: ARKAPHOTO — organizador de lotes · Versión: v0.2.0 · Última migración: 02 (`supabase/002_otp.sql`) · Actualizado: 2026-10-29

## 1. Qué es
Organizador personal de imágenes de un generador. Sube lotes `<ts>-<hash>-<seq>.<ext>` (seq 1–32), detecta posiciones faltantes, las trae de una ruta pública (AWS) y guarda todo en Supabase Storage. Un solo usuario.

## 1.4 Decisiones
- 2026-10-29 · Rango esperado por lote: bloques de 16 (máx ≤16 → 1–16; >16 → 1–32), configurable a "siempre 32".
- 2026-10-29 · Copias "(n)": mismo tamaño que la original → se ignora; sin original → se procesa con nombre limpio; tamaño distinto → se conserva la original y se marca para revisar.
- 2026-10-29 · Bucket: Supabase Storage, lectura pública, escritura solo del dueño. R2 si crece el volumen.
- 2026-10-29 · Login: código de 8 dígitos generado en `/api/auth/send`, enviado por Resend; Supabase solo emite la sesión (`generateLink` → `verifyOtp` con `token_hash`).
- 2026-10-29 · Protocolo de entrega adaptado en `CLAUDE.md` (single-file; funciones Vercel en lugar de Edge).

## 2. Estado por pieza
| Pieza | Versión | Estado |
|---|---|---|
| `public/index.html` | v0.2.0 | desplegado en Vercel; chip hardcodeado en el login (`CFG.VERSION` pendiente) |
| `api/config.js`, `api/traer.js` | v0.1.0 | sin `x-app-version` todavía |
| `api/auth/send.js`, `api/auth/verify.js`, `api/_auth.js` | v0.2.0 | sin probar en producción |
| mig 01 `supabase/schema.sql` | — | pendiente de evidencia de aplicación |
| mig 02 `supabase/002_otp.sql` | — | pendiente de evidencia de aplicación |

## 3.5 Asumidos
- [asumido] 2026-10-29 · mig 01 y 02 aplicadas en Supabase (sin resultado pegado).
- [asumido] 2026-10-29 · variables de Vercel configuradas: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM.
- [asumido] 2026-10-29 · la ruta pública de AWS sirve los archivos sin firma (si no, TRAER devuelve 403 en todo).
- [asumido] 2026-10-29 · `verifyOtp({token_hash, type:'magiclink'})` acepta el hash de `generateLink`; si no, cambiar a `type:'email'`.

## 3.6 Siguientes pasos
1. Evidencia del primer login real (auth.users con el correo; `arkaphoto_otp` vacía después).
2. v0.3.0 — `CFG.VERSION` + chip + comentario de cabecera; `api/version.js`; mig 03 `arkaphoto_migraciones` (y registro retroactivo de 01 y 02); renombrar `schema.sql` → `01_inicial.sql`; bloque Sistema en Configuración.
3. Primer TRAER real contra la ruta pública y registrar el resultado.
4. Borrar `organizador-imagenes.html` de la raíz (piloto) o moverlo a `docs/`.
