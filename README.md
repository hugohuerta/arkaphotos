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
api/sondear.js           determina el tamaño del lote (32→16→8→4→2→1) con HEAD a la ruta pública
api/cola.js              procesa la cola de descarga por tandas (procesar / reintentar / limpiar)
supabase/01_inicial.sql  tablas, RLS, bucket y políticas de Storage
supabase/02_otp.sql      tabla de códigos de acceso
supabase/03_seguridad.sql bucket privado + arkaphoto_migraciones
supabase/04_grants.sql    grants explícitos (obligatorios en este proyecto)
supabase/05_galerias.sql  favoritas, url_origen, tarifa para el dashboard
supabase/06_clasificacion.sql árbol de clasificación (3 niveles) y metadatos por lote
supabase/07_tags.sql      tags por lote
supabase/08_clasif_por_foto.sql clasif_id en cada foto + triggers
supabase/09_ocultas_portada.sql fotos ocultas y portada por lote
supabase/10_tamano_lote.sql tamaño de lote sondeado
supabase/11_dimensiones.sql ancho/alto por foto
supabase/12_cola.sql      cola persistente de URLs
public/app.js            JS de la app (separado del HTML por la CSP)
api/version.js           { app, version, migracion_esperada, migracion_aplicada }
vercel.json              cabeceras de seguridad (CSP, HSTS, no-referrer)
```

## 1. Supabase

1. Crear proyecto. SQL Editor → ejecutar `supabase/01_inicial.sql`, `02_otp.sql`, `03_seguridad.sql`, `04_grants.sql`, `05_galerias.sql`, `06_clasificacion.sql`, `07_tags.sql`, `08_clasif_por_foto.sql`, `09_ocultas_portada.sql`, `10_tamano_lote.sql`, `11_dimensiones.sql` y `12_cola.sql` en orden.
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
| `ALLOWED_FETCH_HOSTS` | opcional, hosts desde los que `/api/traer`, `/api/sondear` y `/api/cola` aceptan descargar (p. ej. `r2-us-west.photoai.com`); vacío = cualquiera |

Deploy desde el repo (framework: Other; sin build; output: `public`). Vercel detecta `api/` solo.

```
git init
git add .
git commit -m "ARKAPHOTO inicial"
vercel
```

## 3. Secciones

- **Inicio**: fotos, espacio ocupado, costo aproximado mensual ((GB − incluidos) × tarifa, ambos editables en Admin), favoritas; tabla por lote.
- **Galerías**: por lote, con ★ favorita; filtro en cascada Tipo → Subgrupo → Detalle, formato (1:1, 16:9, 9:16, 4:3, 3:4), búsqueda de texto, filtro por tag y estado (todos / favoritas / incompletos / sin clasificar). "Editar" asigna nombre, clasificación (Tipo → Subgrupo → Detalle), notas y tags (existentes o nuevos al escribir). Etiqueta: `SUBGRUPO - DETALLE - <ts>` (o `LOTE - <ts>`), con `-A/-B` si el timestamp se repite. "+ Tag" agrega tags sin abrir el editor; ✕ en el tag lo quita. Vistas Cuadrícula / 2X / Pase (clic en una foto o ▶ Pase); Colapsar muestra solo la portada; ↓ ZIP descarga el lote (o las galerías visibles); ★ favorita y ✕ esconder por foto. Imágenes por URL firmada (1 h).
- **Carga fotos**: pestaña *Cargar* (subida PNG/JPG con clasificación opcional para esa carga; resuelve copias `(n)`; sondea el tamaño del lote en la ruta pública y detecta faltantes; "TRAER" las descarga de `{ruta}/{nombre}`) y pestaña *Histórico* (todos los lotes, selección múltiple, clasificación masiva, validar faltantes).
- **Carga de URL**: pega URLs o sube un .txt/.json (extrae todas las URLs de fotos y desenvuelve proxies de redimensión); "Analizar" cuenta nuevas / ya existen / ya en cola / repetidas / no reconocidas; "Encolar" las guarda en `arkaphoto_cola`; "Procesar" las descarga por tandas (pausable, reanudable, con reintentos).
- **Admin**: clasificación de galerías (árbol de 3 niveles), configuración (ruta pública, rango, tarifa, GB incluidos), Sistema (versiones servidas vs esperadas, migración aplicada vs esperada, `x-app-version` de cada función), migraciones aplicadas, validación registro vs bucket.

## Notas

- El bucket es privado: la app pide URLs firmadas (1 h) con sesión; escritura y borrado solo del dueño vía RLS.
- Vercel → Settings → Deployment Protection: activar para previews (las URLs de preview son públicas por default).
- Supabase respalda la base de datos, no Storage: programar una copia del bucket a un segundo destino (R2/B2/NAS con rclone).
- `api/traer.js` corre con `maxDuration = 60`; trae 4 archivos en paralelo y tope de 50 MB por archivo.
- Si la ruta pública de AWS exige URL firmada o bloquea descargas, todo saldrá "no existe" (HTTP 403).
