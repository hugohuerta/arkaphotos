# ARKAPHOTO · reglas de trabajo

Proyecto individual (no forma parte del ecosistema de apps empresariales). Adaptación del "Protocolo de entrega por iteración v1.4": se toma lo que aplica a un sistema de una función con Supabase + Vercel; lo que no aplica se lista al final para no reinterpretarlo cada vez.

Modelo: **single-file** (`public/index.html` + `public/app.js`, separado solo porque la CSP no admite script inline) + funciones Vercel en `api/` + migraciones en `supabase/`. Sin build tooling; librerías por CDN con versión fija.

## 1. Entrega

Una entrega = un incremento de versión `vX.Y.Z` (feat sube Y, fix sube Z). Mensaje con estructura fija:

```
## Entrega vX.Y.Z — <título>
Alcance: qué cambia y qué no (2–4 líneas).

### Archivos
| Archivo | Acción | Versión | Entrega | Destino |

### Pasos a ejecutar
1. SQL        → migración completa + query de verificación con resultado esperado
2. Vercel     → variables de entorno nuevas (nombre, nunca valor) y dónde se obtienen
3. Frontend   → archivos; chip esperado
4. Git        → bloque de comandos, uno por línea
5. Evidencia  → crítica / diferible, numerada

### No incluido / pendiente
```

- Nada ejecutable intercalado en la explicación; todo vive en "Pasos a ejecutar", en ese orden (SQL antes que frontend).
- Un bloque SQL por mensaje.
- Una entrega no mezcla feature y fix de otra cosa; hotfix = entrega `Z+1`.
- Las migraciones SQL se entregan como archivo (adjunto o escrito en carpeta), no pegadas en el chat; en el chat solo van las queries de verificación.

## 2. Archivos

- La versión vive dentro del archivo, nunca en el nombre.
- `public/index.html`: comentario `<!-- ARKAPHOTO vX.Y.Z -->` en la línea 1. `public/app.js`: `CFG.VERSION` y `MIGRACION_ESPERADA`. `api/_version.js`: mismos valores para el backend. Los tres suben juntos en cada entrega.
- Funciones Vercel: `api/<nombre>.js` o `api/<grupo>/<nombre>.js`; exponen `x-app-version` en toda respuesta; `api/version.js` devuelve `{app, version, migracion}`.
- Migraciones: `supabase/NN_descripcion.sql` (dos dígitos, snake_case). Siempre archivo completo e idempotente.
- Docs: `docs/ESTADO.md` (estado, decisiones, asumidos, siguientes pasos) y `docs/CAMBIOS.md` (una línea por versión).
- Archivos completos siempre (todos son chicos). Individuales, nunca ZIP salvo >5 archivos y a petición expresa en ese mensaje.
- Con sesión ligada al equipo el chat escribe directo en `C:\elothedev\arkaphoto\<ruta>` y lo marca "escrito en carpeta"; sin acceso, adjunto con el nombre final.
- **Git**: el chat tiene acceso de push al repo `hugohuerta/arkaphotos`. Regla vigente: el chat escribe archivos y entrega el bloque git; **no hace push** salvo que Hugo lo pida en ese mensaje ("súbelo"). Evita que local y remoto diverjan.

## 3. Commits

`TIPO(MÓDULO) vX.Y.Z — ajuste breve` · TIPO ∈ feat, fix, sql, docs, chore, hotfix · MÓDULO ∈ index, api, auth, sql, docs. Sin emoji.

```
feat(index) v0.3.0 — chip de versión y panel Sistema
sql(arkaphoto) 03 — tabla arkaphoto_migraciones
```

Bloque git literal, un comando por línea:
```
cd C:\elothedev\arkaphoto
git pull
git add <archivos>
git commit -m "feat(index) v0.3.0 — ..."
git push
```

## 4. Queries de verificación

`DDMM.N` (día, mes, consecutivo del día). Cada query lleva cabecera con número, pregunta y **resultado esperado**; una pregunta por query. Las de migración van también al final de la migración como comentario. Se escriben para el SQL Editor (rol postgres, sin sesión): nada que dependa de `auth.uid()`.

Tipos: ¿mig NN aplicada? · ¿RLS? · ¿datos? · ¿API? (`curl` con salida esperada).

## 5. Migraciones

Cabecera fija:
```sql
-- ============================================================
-- ARKAPHOTO · migración NN · <título>
-- Versión de app asociada: vX.Y.Z
-- Fecha: AAAA-MM-DD · Chat: <nombre de sesión>
-- Requiere: migraciones 01..NN-1 aplicadas
-- Idempotente: sí
-- Verificación: DDMM.N (al final)
-- ============================================================
```
Idempotente (`if not exists`, `drop policy if exists` antes de `create policy`). Termina con el registro `insert into arkaphoto_migraciones (num, nombre, version) … on conflict (num) do update`, `notify pgrst, 'reload schema';` y la verificación comentada. Si falla a medias, se corrige y se corre completa otra vez. Nunca datos personales ni llaves en la migración.

## 6. Funciones Vercel (sustituye la ficha de Edge)

Toda entrega que toque `api/` dice: función, archivo, versión, variables de entorno que usa (nombre y origen; nuevas marcadas), y una prueba numerada (`curl` con salida esperada). El deploy lo hace Vercel al hacer push; la evidencia es la prueba, no el "Ready" de Vercel. Secrets nunca se pegan en el chat ni en el repo.

## 7. Evidencia

Dos niveles:
- **Crítica**: migraciones que crean/alteran tablas, policies o grants; variables de entorno nuevas; cualquier paso irreversible; cualquier cosa de la que dependa la siguiente entrega. Se pide con resultado pegado.
- **Diferible**: chip tras deploy, `git push`, UI, textos, docs.

Ritmo: en entregas intermedias el chat **no pide evidencia**; la pide una sola vez en el punto de control (3+ entregas sin verificar, ~4 h de trabajo continuo, o cierre de jornada — este último obligatorio). Máximo 6 ítems, críticas primero, una verificación por resultado final. "ok 1-N" cierra diferibles; las críticas exigen el resultado pegado. Query intermedia solo para diagnosticar o decidir, y se dice "query de diagnóstico".

Texto antes que captura. Captura solo para lo visual. Nunca pedir la misma evidencia dos veces.

Preguntas antes de construir solo cuando: es irreversible, hay dos lecturas razonables y la equivocada cuesta más de una entrega, o toca permisos/acceso. Máximo 3, con opciones y recomendación; sin respuesta, se toma la recomendada y queda `[asumido]` en ESTADO.

## 8. Sistema (versión reducida)

En Configuración, un bloque **Sistema** con botón "Verificar ahora": versión del chip vs comentario del `index.html` servido (`cache: no-store`), `MIGRACION_ESPERADA` vs `max(num)` de `arkaphoto_migraciones`, y `/api/version`. Verde/ámbar/rojo. En el punto de control, el texto de ese bloque sustituye al chip y a las queries "¿mig NN aplicada?". Pendiente de construir (v0.3.0).

## 9. Cierre

Con la evidencia recibida: línea en `docs/CAMBIOS.md`, actualización de `docs/ESTADO.md` (decisiones, estado, asumidos, siguientes pasos) y una línea "Cerrada vX.Y.Z. Siguiente: …". Una entrega sin cierre se lista como abierta en el siguiente mensaje.

Al reanudar en un chat nuevo: adjuntar `docs/ESTADO.md` y este `CLAUDE.md`; el chat confirma versión y última migración antes de proponer nada. Nombre de sesión: `ARKAPHOTO — <tema>`.

## 10. Qué del protocolo v1.4 NO aplica aquí y por qué

- Arquitectura por módulos (core + páginas, `NAV` por ámbito, enlaces profundos): es un sistema de una función → single-file.
- Edge Functions de Supabase, ficha de deploy CLI/manual, headers `x-fn-name`: la lógica de servidor corre en funciones Vercel con deploy por push (§6 las sustituye).
- `scripts/verificar.js`: el único HTML es chico; se evalúa cuando pase de ~1,500 líneas.
- Entregas numeradas `E1, E2…`: no hay plan multi-fase.
- `arka-ecosistema/ECOSISTEMA.md`, contratos, maestros, fronteras entre apps, "afecta a otro ARKA": no hay otras apps.
- Perfiles, roles, ámbitos, log de operación multiusuario: un solo usuario (lista blanca opcional por variable de entorno).
- Emoji en commits: no se adopta.
