-- ============================================================
-- ARKAPHOTO · migración 15 · marca "validado previamente" en lotes
-- Versión de app asociada: v0.24.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..14 aplicadas
-- Idempotente: sí
-- Verificación: 3010.9 (al final)
-- ============================================================

-- validado_en: momento en que se comprobó contra el origen que las faltantes del lote no existen
-- (TRAER sin resultados, o 404 definitivo en la cola). La validación masiva omite estos lotes.
alter table public.arkaphoto_lotes
  add column if not exists validado_en timestamptz;

-- Si llegan fotos nuevas al lote (subida, cola, mejora), la marca deja de aplicar: se limpia.
create or replace function public.arkaphoto_lote_revalida() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.arkaphoto_lotes set validado_en = null
   where user_id = new.user_id and lote = new.lote and validado_en is not null;
  return new;
end $$;
drop trigger if exists arkaphoto_imagenes_revalida on public.arkaphoto_imagenes;
create trigger arkaphoto_imagenes_revalida
  after insert on public.arkaphoto_imagenes
  for each row execute function public.arkaphoto_lote_revalida();

grant select, insert, update, delete on public.arkaphoto_lotes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (15, '15_validado', 'v0.24.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.9 · ¿mig 15 aplicada? (esperado: 2 filas: columna validado_en · trigger arkaphoto_imagenes_revalida)
-- select 'columna' tipo, column_name valor from information_schema.columns where table_name='arkaphoto_lotes' and column_name='validado_en'
-- union all select 'trigger', tgname from pg_trigger where tgname='arkaphoto_imagenes_revalida';
-- ------------------------------------------------------------
