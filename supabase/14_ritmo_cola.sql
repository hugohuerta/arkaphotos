-- ============================================================
-- ARKAPHOTO · migración 14 · ritmo de descarga de la cola (para no parecer tráfico abusivo ante el origen)
-- Versión de app asociada: v0.19.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..13 aplicadas
-- Idempotente: sí
-- Verificación: 3010.7 (al final)
-- ============================================================

alter table public.arkaphoto_config
  add column if not exists cola_concurrencia smallint not null default 1 check (cola_concurrencia between 1 and 4),
  add column if not exists cola_pausa_ms     integer  not null default 1500 check (cola_pausa_ms between 0 and 60000),
  add column if not exists cola_tanda        smallint not null default 12 check (cola_tanda between 1 and 48),
  add column if not exists cola_espera_s     smallint not null default 10 check (cola_espera_s between 0 and 600);

grant select, insert, update, delete on public.arkaphoto_config to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (14, '14_ritmo_cola', 'v0.19.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.7 · ¿mig 14 aplicada? (esperado: 4 columnas cola_*)
-- select column_name from information_schema.columns where table_name='arkaphoto_config' and column_name like 'cola_%' order by 1;
-- ------------------------------------------------------------
