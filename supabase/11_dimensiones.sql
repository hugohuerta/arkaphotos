-- ============================================================
-- ARKAPHOTO · migración 11 · dimensiones de cada foto (para filtrar por formato)
-- Versión de app asociada: v0.12.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..10 aplicadas
-- Idempotente: sí
-- Verificación: 3010.2 (al final)
-- ============================================================

alter table public.arkaphoto_imagenes
  add column if not exists ancho smallint,
  add column if not exists alto  smallint;

grant select, insert, update, delete on public.arkaphoto_imagenes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (11, '11_dimensiones', 'v0.12.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.2 · ¿mig 11 aplicada? (esperado: alto, ancho)
-- select column_name from information_schema.columns where table_name='arkaphoto_imagenes' and column_name in ('ancho','alto') order by 1;
-- ------------------------------------------------------------
