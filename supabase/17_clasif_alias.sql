-- ============================================================
-- ARKAPHOTO · migración 17 · alias y marca "rápida" en subcategorías
-- Versión de app asociada: v0.26.0
-- Fecha: 2026-10-31 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..16 aplicadas
-- Idempotente: sí
-- Verificación: 3110.2 (al final)
-- ============================================================

-- alias: nombre corto (≤24) para la clasificación rápida de Galerías; rapida: aparece en esa lista.
-- Se usan en nivel 2 (Subcategoría); las columnas existen en toda la tabla por simplicidad.
alter table public.arkaphoto_clasif
  add column if not exists alias text check (alias is null or char_length(alias) between 1 and 24),
  add column if not exists rapida boolean not null default false;

grant select, insert, update, delete on public.arkaphoto_clasif to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (17, '17_clasif_alias', 'v0.26.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3110.2 · ¿mig 17 aplicada? (esperado: 2 filas: alias | text · rapida | boolean)
-- select column_name, data_type from information_schema.columns where table_name='arkaphoto_clasif' and column_name in ('alias','rapida') order by 1;
-- ------------------------------------------------------------
