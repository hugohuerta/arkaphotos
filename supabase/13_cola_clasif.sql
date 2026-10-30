-- ============================================================
-- ARKAPHOTO · migración 13 · clasificación elegida al encolar URLs
-- Versión de app asociada: v0.15.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..12 aplicadas
-- Idempotente: sí
-- Verificación: 3010.4 (al final)
-- ============================================================

alter table public.arkaphoto_cola add column if not exists clasif_id bigint references public.arkaphoto_clasif(id) on delete set null;
grant select, insert, update, delete on public.arkaphoto_cola to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (13, '13_cola_clasif', 'v0.15.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.4 · ¿mig 13 aplicada? (esperado: 1 fila: clasif_id)
-- select column_name from information_schema.columns where table_name='arkaphoto_cola' and column_name='clasif_id';
-- ------------------------------------------------------------
