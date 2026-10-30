-- ============================================================
-- ARKAPHOTO · migración 10 · tamaño del lote (potencia de 2) determinado por sondeo
-- Versión de app asociada: v0.11.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: regla "bloques de 16" (config.rango deja de usarse; la columna se conserva)
-- Requiere: migraciones 01..09 aplicadas
-- Idempotente: sí
-- Verificación: 3010.1 (al final)
-- ============================================================

alter table public.arkaphoto_lotes
  add column if not exists tamano smallint check (tamano in (1,2,4,8,16,32)),
  add column if not exists sondeado_en timestamptz;

grant select, insert, update, delete on public.arkaphoto_lotes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (10, '10_tamano_lote', 'v0.11.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.1 · ¿mig 10 aplicada? (esperado: 2 filas: sondeado_en, tamano)
-- select column_name from information_schema.columns where table_name='arkaphoto_lotes' and column_name in ('tamano','sondeado_en') order by 1;
-- ------------------------------------------------------------
