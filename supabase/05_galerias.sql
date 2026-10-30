-- ============================================================
-- ARKAPHOTO · migración 05 · favoritas, origen por URL y tarifa para el dashboard
-- Versión de app asociada: v0.4.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..04 aplicadas
-- Idempotente: sí
-- Verificación: 2910.9 (al final)
-- ============================================================

alter table public.arkaphoto_imagenes
  add column if not exists favorita   boolean not null default false,
  add column if not exists url_origen text;

create index if not exists arkaphoto_imagenes_favoritas on public.arkaphoto_imagenes (user_id) where favorita;

alter table public.arkaphoto_config
  add column if not exists tarifa_gb_usd numeric(8,4) not null default 0.021,   -- Supabase Storage, doc de precios 2026-10
  add column if not exists gb_incluidos  numeric(8,2) not null default 1;       -- plan Free; Pro = 100

-- Grants: las columnas nuevas heredan los de tabla (mig 04); se reafirman por si la tabla se recrea
grant select, insert, update, delete on public.arkaphoto_config, public.arkaphoto_imagenes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (5, '05_galerias', 'v0.4.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.9 · ¿mig 05 aplicada? (esperado: 4 filas: favorita, url_origen, tarifa_gb_usd, gb_incluidos)
-- select table_name, column_name from information_schema.columns
-- where table_schema='public' and (
--   (table_name='arkaphoto_imagenes' and column_name in ('favorita','url_origen')) or
--   (table_name='arkaphoto_config'   and column_name in ('tarifa_gb_usd','gb_incluidos')))
-- order by 1,2;
-- ------------------------------------------------------------
