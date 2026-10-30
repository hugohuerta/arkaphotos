# ARKAPHOTO

Organizador de lotes de imágenes del generador. Sube imágenes, detecta posiciones faltantes (1–32 por lote), las trae de una ruta pública y las guarda en un bucket.

Stack: HTML estático + `@supabase/supabase-js` (CDN) · Supabase Auth (OTP por correo) + Postgres + Storage · Vercel (estático + 2 funciones en `api/`).

## Estructura

```
public/index.html        app completa (login, organizador, galería en #galeria)
api/config.js            entrega URL y anon key al navegador
api/traer.js             jala faltantes de la ruta pública → bucket (usa service role)
supabase/schema.sql      tablas, RLS, bucket y políticas de Storage
```

## 1. Supabase

1. Crear proyecto. SQL Editor → pegar y ejecutar `supabase/schema.sql`.
2. **Authentication → Providers → Email**: dejar habilitado. En **Authentication → Settings** (o Email provider, según versión del dashboard) poner **Email OTP Length = 8**. Si no lo cambias, el código llega de 6 dígitos y el campo del login lo rechaza.
3. **Authentication → Email Templates → Magic Link**: el cuerpo debe incluir `{{ .Token }}` (el código), no solo `{{ .ConfirmationURL }}`. Ejemplo mínimo:
   ```
   <p>Tu código ARKAPHOTO: <b>{{ .Token }}</b></p>
   ```
4. Tras tu primer login, en **Authentication → Settings** apagar **Allow new users to sign up** para que nadie más se cree cuenta con su correo.
5. Copiar de **Project Settings → API**: Project URL, anon key, service_role key.

## 2. Vercel

Variables de entorno del proyecto:

| Variable | Dónde |
|---|---|
| `SUPABASE_URL` | Project URL |
| `SUPABASE_ANON_KEY` | anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role (solo servidor; nunca al cliente) |

Deploy desde el repo (framework: Other; sin build; output: `public`). Vercel detecta `api/` solo.

```
git init
git add .
git commit -m "ARKAPHOTO inicial"
vercel
```

## 3. Flujo

1. Correo → código de 8 dígitos → sesión.
2. Configuración: ruta pública (base de la URL de AWS) y regla de rango (bloques de 16 o siempre 32).
3. Subir imágenes: se resuelven copias `(n)` (mismo tamaño → se ignora; sin original → se procesa con nombre limpio; tamaño distinto → se conserva la original y se marca). Cada imagen va a `arkaphoto/<uid>/<lote>/<nombre>` y a `arkaphoto_imagenes`.
4. Faltantes → "Sí, validar" → **TRAER a ARKAPHOTO** → `/api/traer` descarga `{ruta}/{nombre}` por cada faltante y la guarda con `origen = traida`.
5. "Galería ↗" abre `#galeria` en otra pestaña con todo el bucket por lote.

## Notas

- El bucket es de lectura pública (URLs permanentes); escritura y borrado solo del dueño vía RLS.
- `api/traer.js` corre con `maxDuration = 60`; trae 4 archivos en paralelo y tope de 50 MB por archivo.
- Si la ruta pública de AWS exige URL firmada o bloquea descargas, todo saldrá "no existe" (HTTP 403).
