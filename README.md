# ARKAPHOTO

Organizador de lotes de imágenes del generador. Sube imágenes, detecta posiciones faltantes (1–32 por lote), las trae de una ruta pública y las guarda en un bucket.

Stack: HTML estático + `@supabase/supabase-js` (CDN) · Supabase Auth + Postgres + Storage · Resend (correo con el código) · Vercel (estático + funciones en `api/`).

## Estructura

```
public/index.html        app completa (login, organizador, galería en #galeria)
api/config.js            entrega URL y anon key al navegador
api/auth/send.js         genera código de 8 dígitos, lo guarda hasheado, lo manda por Resend
api/auth/verify.js       valida el código y devuelve token_hash de Supabase para abrir sesión
api/_auth.js             utilidades compartidas de auth (no es endpoint)
api/traer.js             jala faltantes de la ruta pública → bucket (usa service role)
supabase/01_inicial.sql  tablas, RLS, bucket y políticas de Storage
supabase/02_otp.sql      tabla de códigos de acceso
supabase/03_seguridad.sql bucket privado + arkaphoto_migraciones
supabase/04_grants.sql    grants explícitos (obligatorios en este proyecto)
public/app.js            JS de la app (separado del HTML por la CSP)
api/version.js           { app, version, migracion_esperada, migracion_aplicada }
vercel.json              cabeceras de seguridad (CSP, HSTS, no-referrer)
```

## 1. Supabase

1. Crear proyecto. SQL Editor → ejecutar `supabase/01_inicial.sql`, `02_otp.sql`, `03_seguridad.sql` y `04_grants.sql` en orden.
2. **Authentication → Providers → Email**: dejar habilitado (la sesión se abre con un enlace mágico generado en servidor; el correo lo manda Resend, no Supabase).
3. Copiar de **Project Settings → API**: Project URL, anon key, service_role key.

**Alta de usuarios**: Authentication → Users → Add user (con el correo). El login solo pide código a correos que existan ahí; no se autocrean.

## 1b. Resend

1. Verificar el dominio desde el que saldrán los correos (DNS: SPF/DKIM).
2. Crear API key con permiso de envío.
3. El remitente va en `RESEND_FROM`, p. ej. `elothe.dev <acceso@elothe.dev>`.

## 2. Vercel

Variables de entorno del proyecto:

| Variable | Dónde |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (solo servidor; nunca al cliente) |
| `RESEND_API_KEY` | Resend → API Keys |
| `RESEND_FROM` | remitente verificado, `Nombre <correo@dominio>` |
| `APP_NAME` | opcional, nombre en el correo (default `ARKAPHOTO`) |
| `OTP_SECRET` | opcional, sal del hash de códigos (default: service key) |
| `ALLOWED_EMAILS` / `ALLOWED_EMAIL_DOMAINS` | lista blanca separada por comas; vacío = cualquiera (**no recomendado**: cualquiera podría gastar tu cuota de Resend) |
| `ALLOWED_FETCH_HOSTS` | opcional, hosts desde los que `/api/traer` acepta descargar; vacío = cualquiera |

Deploy desde el repo (framework: Other; sin build; output: `public`). Vercel detecta `api/` solo.

```
git init
git add .
git commit -m "ARKAPHOTO inicial"
vercel
```

## 3. Flujo

1. Correo → `/api/auth/send` manda un código de 8 dígitos por Resend (caduca en 10 min, 5 intentos, reenvío cada 45 s) → `/api/auth/verify` lo valida y entrega un `token_hash` → `supabase.auth.verifyOtp` abre la sesión. El usuario de Auth se crea en el primer acceso.
2. Configuración: ruta pública (base de la URL de AWS) y regla de rango (bloques de 16 o siempre 32).
3. Subir imágenes: se resuelven copias `(n)` (mismo tamaño → se ignora; sin original → se procesa con nombre limpio; tamaño distinto → se conserva la original y se marca). Cada imagen va a `arkaphoto/<uid>/<lote>/<nombre>` y a `arkaphoto_imagenes`.
4. Faltantes → "Sí, validar" → **TRAER a ARKAPHOTO** → `/api/traer` descarga `{ruta}/{nombre}` por cada faltante y la guarda con `origen = traida`.
5. "Galería ↗" abre `#galeria` en otra pestaña con todo el bucket por lote.

## Notas

- El bucket es privado: la app pide URLs firmadas (1 h) con sesión; escritura y borrado solo del dueño vía RLS.
- Vercel → Settings → Deployment Protection: activar para previews (las URLs de preview son públicas por default).
- Supabase respalda la base de datos, no Storage: programar una copia del bucket a un segundo destino (R2/B2/NAS con rclone).
- `api/traer.js` corre con `maxDuration = 60`; trae 4 archivos en paralelo y tope de 50 MB por archivo.
- Si la ruta pública de AWS exige URL firmada o bloquea descargas, todo saldrá "no existe" (HTTP 403).
