-- ============================================================
-- ARKAPHOTO · migración 16 · orden de las listas de clasificación (alfabético / más uso) por nivel
-- Versión de app asociada: v0.25.0
-- Fecha: 2026-10-31 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..15 aplicadas
-- Idempotente: sí
-- Verificación: 3110.1 (al final)
-- ============================================================

-- {"1":"alfa"|"uso", "2":…, "3":…}  (1 = Categoría, 2 = Subcategoría, 3 = Grupo)
alter table public.arkaphoto_config
  add column if not exists clasif_orden jsonb not null default '{"1":"alfa","2":"alfa","3":"alfa"}'::jsonb;

grant select, insert, update, delete on public.arkaphoto_config to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (16, '16_clasif_orden', 'v0.25.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3110.1 · ¿mig 16 aplicada? (esperado: 1 fila: clasif_orden | jsonb)
-- select column_name, data_type from information_schema.columns where table_name='arkaphoto_config' and column_name='clasif_orden';
-- ------------------------------------------------------------
