# CAMBIOS · ARKAPHOTO

- v0.3.1 — 2026-10-29 — fix login: `hidden` anulado por CSS (todo visible), versión no mostrada; el código solo se pide si el correo existe en Supabase Auth (sin autocrear usuarios)
- v0.3.0 — 2026-10-29 — seguridad: bucket privado + URLs firmadas, lista blanca silenciosa, hosts permitidos en traer, CSP/HSTS/no-referrer (vercel.json), JS separado en app.js, chip de versión, /api/version (mig 03 arkaphoto_migraciones)
- v0.2.0 — 2026-10-29 — login con código de 8 dígitos por Resend; sesión Supabase vía token_hash (mig 02 arkaphoto_otp)
- v0.1.0 — 2026-10-29 — organizador de lotes: subida a Storage, faltantes, TRAER desde ruta pública, galería (#galeria) (mig 01 schema.sql)
