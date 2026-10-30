-- ============================================================
-- ARKAPHOTO · migración 09 · fotos ocultas y portada por lote
-- Versión de app asociada: v0.8.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..08 aplicadas
-- Idempotente: sí
-- Verificación: 2910.13 (al final)
-- ============================================================

alter table public.arkaphoto_imagenes add column if not exists oculta boolean not null default false;
alter table public.arkaphoto_lotes    add column if not exists portada_seq smallint check (portada_seq between 1 and 32);

grant select, insert, update, delete on public.arkaphoto_imagenes, public.arkaphoto_lotes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (9, '09_ocultas_portada', 'v0.8.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.13 · ¿mig 09 aplicada? (esperado: 2 filas: imagenes.oculta, lotes.portada_seq)
-- select table_name, column_name from information_schema.columns
-- where (table_name='arkaphoto_imagenes' and column_name='oculta') or (table_name='arkaphoto_lotes' and column_name='portada_seq') order by 1;
-- ------------------------------------------------------------
