# CAMBIOS · ARKAPHOTO

- v0.11.0 — 2026-10-30 — tamaño de lote por potencia de 2 (1·2·4·8·16·32) determinado sondeando la ruta pública de mayor a menor (/api/sondear); se guarda por lote (mig 10); sondeo automático al subir y botón en Histórico; desaparece la regla "bloques de 16"
- v0.10.2 — 2026-10-30 — Cargar: banner "Faltan X fotos" arriba de los lotes con acceso directo a validar/traer; tras clasificar, aviso FOTOS CLASIFICADAS con "Nueva carga" (limpia la sesión y recarga datos)
- v0.10.1 — 2026-10-29 — Cargar: la clasificación va después de la carga, con casillas por lote (preseleccionados los recién subidos) y "Aplicar a los seleccionados"
- v0.10.0 — 2026-10-29 — Carga fotos en pestañas: Cargar (solo lo subido en la sesión, con clasificación opcional Tipo/Subgrupo/Detalle aplicada a los lotes nuevos) e Histórico (todos los lotes, selección múltiple, Clasificar seleccionados, Validar faltantes)
- v0.9.0 — 2026-10-29 — Inicio: tabla "Últimos lotes" ordenada por fecha (timestamp de la clave) con filtros desde/hasta, subgrupo y búsqueda
- v0.8.2 — 2026-10-29 — botones 💾 guardar y 🔍 abrir en pestaña sobre cada foto (esquinas inferiores); el clic al centro sigue abriendo el pase
- v0.8.1 — 2026-10-29 — Galerías: filtros en cajas (Filtro · Vista · Tags); vista Lista (filas); pase a pantalla completa con Guardar foto y Abrir; ★ y ✕ separados en esquinas opuestas con área de clic mayor
- v0.8.0 — 2026-10-29 — Galerías: datos de la foto solo en modo Editar; vistas Cuadrícula / 2X / Pase (foto grande con flechas y teclado); colapsar lotes a portada (default: primera subida; elegible en Editar); descarga ZIP por lote o de las visibles (en el navegador, JSZip); fotos ocultas (✕) con filtro Ocultas (mig 09)
- v0.7.0 — 2026-10-29 — etiqueta de galería = SUBGRUPO [- DETALLE] - <ts>; clasificación del lote replicada en cada foto (columna + triggers, mig 08); cabecera reducida: etiqueta, tags con quitar, conteo grande, + Tag rápido, Editar
- v0.6.0 — 2026-10-29 — Galerías: filtro en cascada Tipo → Subgrupo → Detalle, búsqueda de texto, filtro por tag; tags por lote (existentes o nuevos al escribir) en Editar; tags administrables en Admin → Clasificación (mig 07)
- v0.5.1 — 2026-10-29 — Admin en pestañas (Configuración de URL · Clasificación de galerías · Sistema); Sistema verifica automáticamente al abrirse
- v0.5.0 — 2026-10-29 — clasificación de galerías en 3 niveles (Tipo → Subgrupo → Detalle) administrada en Admin; metadatos por lote (nombre, clasificación, notas) editables en Galerías; etiqueta de lote LOTE <ts>[-A] / NOMBRE <ts>[-A]; filtro por tipo y "sin clasificar" (mig 06)
- v0.4.0 — 2026-10-29 — menú: Inicio (dashboard: fotos, espacio, costo aprox., favoritas), Galerías (favoritas, filtros), Carga fotos, Carga de URL (valida existencia antes de traer), Admin (config, Sistema, migraciones, validación registro vs bucket); /api/traer acepta urls[] (mig 05)
- v0.3.2 — 2026-10-29 — fix auth: los errores de send/verify dicen la etapa y el mensaje del proveedor; mig 04 grants explícitos (el proyecto no daba DML a authenticated/service_role)
- v0.3.1 — 2026-10-29 — fix login: `hidden` anulado por CSS (todo visible), versión no mostrada; el código solo se pide si el correo existe en Supabase Auth (sin autocrear usuarios)
- v0.3.0 — 2026-10-29 — seguridad: bucket privado + URLs firmadas, lista blanca silenciosa, hosts permitidos en traer, CSP/HSTS/no-referrer (vercel.json), JS separado en app.js, chip de versión, /api/version (mig 03 arkaphoto_migraciones)
- v0.2.0 — 2026-10-29 — login con código de 8 dígitos por Resend; sesión Supabase vía token_hash (mig 02 arkaphoto_otp)
- v0.1.0 — 2026-10-29 — organizador de lotes: subida a Storage, faltantes, TRAER desde ruta pública, galería (#galeria) (mig 01 schema.sql)
