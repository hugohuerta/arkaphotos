# ESTADO · ARKAPHOTO

Sesión: ARKAPHOTO — organizador de lotes · Versión: v0.3.2 · Última migración: 03 (`supabase/03_seguridad.sql`) · Actualizado: 2026-10-29

## 1. Qué es
Organizador personal de imágenes de un generador. Sube lotes `<ts>-<hash>-<seq>.<ext>` (seq 1–32), detecta posiciones faltantes, las trae de una ruta pública (AWS) y guarda todo en Supabase Storage. Un solo usuario.

## 1.4 Decisiones
- 2026-10-29 · Rango esperado por lote: bloques de 16 (máx ≤16 → 1–16; >16 → 1–32), configurable a "siempre 32".
- 2026-10-29 · Copias "(n)": mismo tamaño que la original → se ignora; sin original → se procesa con nombre limpio; tamaño distinto → se conserva la original y se marca para revisar.
- 2026-10-29 · Bucket: Supabase Storage **privado** (v0.3.0; antes público). Lectura con URLs firmadas de 1 h; escritura solo del dueño. R2 si crece el volumen.
- 2026-10-29 · Prioridades de seguridad acordadas: lista blanca → cabeceras/Deployment Protection → bucket privado → hosts permitidos → respaldo del bucket (fuera del stack, pendiente).
- 2026-10-29 · Login: el paso del código solo aparece si el correo existe en Supabase Auth; el servidor responde 404 explícito (decisión de Hugo: UX sobre anti-enumeración, un solo usuario). Los usuarios se dan de alta en Authentication → Users.
- 2026-10-29 · Single-file con excepción: el JS vive en `public/app.js` porque la CSP no permite script inline.
- 2026-10-29 · Login: código de 8 dígitos generado en `/api/auth/send`, enviado por Resend; Supabase solo emite la sesión (`generateLink` → `verifyOtp` con `token_hash`).
- 2026-10-29 · Protocolo de entrega adaptado en `CLAUDE.md` (single-file; funciones Vercel en lugar de Edge).

## 2. Estado por pieza
| Pieza | Versión | Estado |
|---|---|---|
| `public/index.html` + `public/app.js` | v0.3.1 | `CFG.VERSION`, chip, URLs firmadas; pendiente de deploy |
| `api/*` | v0.3.1 | `x-app-version` en todas; `/api/version` nuevo |
| `api/auth/*` | v0.3.1 | solo correos registrados; login real aún sin cerrar (usuario creado, `last_sign_in_at` nulo) |
| mig 01, 02 | — | aplicadas (2910.1, verificado por el chat vía MCP) |
| mig 03 | — | aplicada por el chat vía MCP (2910.3) |

## 3.5 Asumidos
- [asumido] 2026-10-29 · variables de Vercel configuradas: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM (el proyecto de Vercel no es visible desde el MCP del chat).
- [asumido] 2026-10-29 · ALLOWED_EMAILS y Deployment Protection los configura Hugo (pasos de v0.3.0).
- [asumido] 2026-10-29 · la ruta pública de AWS sirve los archivos sin firma (si no, TRAER devuelve 403 en todo).
- [asumido] 2026-10-29 · `verifyOtp({token_hash, type:'magiclink'})` acepta el hash de `generateLink`; si no, cambiar a `type:'email'`.

## 3.6 Siguientes pasos
1. Evidencia del primer login real (`last_sign_in_at` no nulo; `arkaphoto_otp` vacía después).
2. Respaldo del bucket a un segundo destino (rclone → R2/B2/NAS Synology), programado.
3. v0.4.0 — bloque Sistema en Configuración (chip vs servido, `/api/version`, migración esperada vs aplicada); borrado suave (`eliminado_en`).
4. Primer TRAER real contra la ruta pública y registrar el resultado.
5. Compartir: generar URL firmada larga explícita por imagen (hoy no hay forma de compartir fuera de la app).
