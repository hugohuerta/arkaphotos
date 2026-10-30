# ESTADO · ARKAPHOTO

Sesión: ARKAPHOTO — organizador de lotes · Versión: v0.11.0 · Última migración: 10 (`supabase/10_tamano_lote.sql`) · Actualizado: 2026-10-29

## 1. Qué es
Organizador personal de imágenes de un generador. Sube lotes `<ts>-<hash>-<seq>.<ext>` (seq 1–32), detecta posiciones faltantes, las trae de una ruta pública (AWS) y guarda todo en Supabase Storage. Un solo usuario.

## 1.4 Decisiones
- 2026-10-30 · Tamaño del lote (sustituye a "bloques de 16"): potencia de 2. Se sondea la ruta pública con HEAD en orden 32 → 16 → 8 → 4 → 2; la primera que existe fija el tamaño; si ninguna, 1. Nunca por debajo de pow2(máx subido). Resultado en `arkaphoto_lotes.tamano` + `sondeado_en`; sin sondeo se asume pow2(máx subido) y se marca con "?". `config.rango` queda sin uso.
- 2026-10-29 · Copias "(n)": mismo tamaño que la original → se ignora; sin original → se procesa con nombre limpio; tamaño distinto → se conserva la original y se marca para revisar.
- 2026-10-29 · Bucket: Supabase Storage **privado** (v0.3.0; antes público). Lectura con URLs firmadas de 1 h; escritura solo del dueño. R2 si crece el volumen.
- 2026-10-29 · Prioridades de seguridad acordadas: lista blanca → cabeceras/Deployment Protection → bucket privado → hosts permitidos → respaldo del bucket (fuera del stack, pendiente).
- 2026-10-29 · Login: el paso del código solo aparece si el correo existe en Supabase Auth; el servidor responde 404 explícito (decisión de Hugo: UX sobre anti-enumeración, un solo usuario). Los usuarios se dan de alta en Authentication → Users.
- 2026-10-29 · Este proyecto Supabase no otorga DML por default a `authenticated`/`service_role`; toda migración lleva grants explícitos (mig 04 fijó también los default privileges).
- 2026-10-29 · Menú de 5 secciones (#inicio, #galerias, #carga, #urls, #admin). Costo del dashboard = (GB − GB incluidos) × tarifa; tarifa y GB incluidos editables en Admin (defaults: US$0.021/GB-mes, 1 GB, doc de precios de Supabase Storage, oct-2026).
- 2026-10-29 · Carga de URL: el nombre del archivo se toma de la URL; se omite lo que ya existe (cliente y servidor). `/api/traer` acepta `{urls:[...]}` con tope de 64 por llamada.
- 2026-10-29 · Clasificación: árbol `arkaphoto_clasif` de 3 niveles por usuario (tipos iniciales: Persona, Grupo, Lugar, Evento, Mascota, Objeto, Concepto; editables). Cada lote tiene una sola ruta de clasificación (`arkaphoto_lotes.clasif_id` apunta al nivel más profundo asignado). No se borra un nivel con hijos o con galerías asignadas.
- 2026-10-29 · Etiqueta de lote (v0.7.0): `SUBGRUPO - <ts>` y `SUBGRUPO - DETALLE - <ts>` cuando hay clasificación; si no, `NOMBRE - <ts>` (campo nombre) o `LOTE - <ts>`. Sufijo `-A`, `-B`… si el timestamp se repite. La clave completa queda solo en el tooltip.
- 2026-10-29 · `arkaphoto_imagenes.clasif_id` replica la clasificación del lote: trigger al guardar el lote y trigger al insertar fotos nuevas.
- 2026-10-29 · Tags: libres, por lote, N a N (`arkaphoto_tags` + `arkaphoto_lote_tags`); se crean al escribir en Editar (Enter o coma), se renombran/borran en Admin → Clasificación (borrar solo sin uso). La búsqueda de Galerías cubre etiqueta, clave, nombre, notas, clasificación y tags.
- 2026-10-29 · Ocultas: `imagenes.oculta`; salen de la vista normal, del pase, de la portada y del ZIP; se recuperan con el filtro Ocultas o en modo Editar. Portada: `lotes.portada_seq`; si no hay, la primera subida visible. Estado de colapsado y vista (1x/2x) en localStorage del navegador. ZIP sin compresión (STORE) armado en el navegador con JSZip 3.10.1.
- 2026-10-29 · Fecha de lote = timestamp de la clave (segundos Unix; si viene en ms también se interpreta). Es la única fecha disponible: no se guarda fecha de carga por lote.
- 2026-10-29 · Carga: tras subir, los lotes de la sesión aparecen con casilla (marcados por default) y un panel para aplicarles Tipo/Subgrupo/Detalle (sobrescribe si ya tenían); los masivos en Histórico igual. Los niveles son opcionales: se guarda el más profundo elegido.
- 2026-10-29 · Single-file con excepción: el JS vive en `public/app.js` porque la CSP no permite script inline.
- 2026-10-29 · Login: código de 8 dígitos generado en `/api/auth/send`, enviado por Resend; Supabase solo emite la sesión (`generateLink` → `verifyOtp` con `token_hash`).
- 2026-10-29 · Protocolo de entrega adaptado en `CLAUDE.md` (single-file; funciones Vercel en lugar de Edge).

## 2. Estado por pieza
| Pieza | Versión | Estado |
|---|---|---|
| `public/index.html` + `public/app.js` | v0.11.0 | clasificación en Admin; editor por galería; etiquetas de lote |
| `api/*` | v0.4.0 | `/api/traer` acepta lote+seqs o urls[] |
| `api/auth/*` | v0.3.2 | login real confirmado por Hugo (2026-10-29 22:43) |
| mig 01, 02 | — | aplicadas (2910.1, verificado por el chat vía MCP) |
| mig 03 | — | aplicada por el chat vía MCP (2910.3) |
| mig 04 | — | aplicada por el chat vía MCP (2910.8): grants; sin esto fallaba todo DML desde la app |
| mig 05 | — | aplicada por el chat vía MCP (2910.9): favorita, url_origen, tarifa |
| mig 06 | — | aplicada por el chat vía MCP (2910.10): arkaphoto_clasif, arkaphoto_lotes, 7 tipos iniciales |
| mig 07 | — | aplicada por el chat vía MCP (2910.11): arkaphoto_tags, arkaphoto_lote_tags |
| mig 08 | — | aplicada por el chat vía MCP (2910.12): imagenes.clasif_id + triggers de propagación/herencia; 32/32 fotos rellenadas |
| mig 09 | — | aplicada por el chat vía MCP (2910.13): imagenes.oculta, lotes.portada_seq |
| mig 10 | — | aplicada por el chat vía MCP (3010.1): lotes.tamano, sondeado_en |

## 3.5 Asumidos
- [asumido] 2026-10-29 · variables de Vercel configuradas: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM (el proyecto de Vercel no es visible desde el MCP del chat).
- [asumido] 2026-10-29 · ALLOWED_EMAILS y Deployment Protection los configura Hugo (pasos de v0.3.0).
- [asumido] 2026-10-29 · la ruta pública de AWS sirve los archivos sin firma (si no, TRAER devuelve 403 en todo).

## 3.6 Siguientes pasos
1. Respaldo del bucket a un segundo destino (rclone → R2/B2/NAS Synology), programado.
2. Primer TRAER real (ruta pública o lista de URLs) y registrar el resultado.
3. Borrado suave (`eliminado_en`) y borrar desde Galerías.
4. Compartir: URL firmada larga explícita por imagen.
5. Admin → "Sistema" como evidencia en el punto de control (ya existe el bloque).
