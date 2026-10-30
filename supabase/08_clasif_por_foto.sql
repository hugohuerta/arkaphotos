-- ============================================================
-- ARKAPHOTO · migración 08 · clasificación del lote replicada en cada foto
-- Versión de app asociada: v0.7.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..07 aplicadas
-- Idempotente: sí
-- Verificación: 2910.12 (al final)
-- ============================================================

alter table public.arkaphoto_imagenes
  add column if not exists clasif_id bigint references public.arkaphoto_clasif(id) on delete set null;
create index if not exists arkaphoto_imagenes_clasif on public.arkaphoto_imagenes (user_id, clasif_id);

-- Al cambiar la clasificación del lote, se propaga a todas sus fotos
create or replace function public.arkaphoto_lote_propaga_clasif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.arkaphoto_imagenes set clasif_id = new.clasif_id
   where user_id = new.user_id and lote = new.lote and clasif_id is distinct from new.clasif_id;
  return new;
end $$;
drop trigger if exists arkaphoto_lotes_propaga on public.arkaphoto_lotes;
create trigger arkaphoto_lotes_propaga
  after insert or update of clasif_id on public.arkaphoto_lotes
  for each row execute function public.arkaphoto_lote_propaga_clasif();

-- Una foto nueva hereda la clasificación que ya tenga su lote
create or replace function public.arkaphoto_imagen_hereda_clasif() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.clasif_id is null then
    select l.clasif_id into new.clasif_id from public.arkaphoto_lotes l
     where l.user_id = new.user_id and l.lote = new.lote;
  end if;
  return new;
end $$;
drop trigger if exists arkaphoto_imagenes_hereda on public.arkaphoto_imagenes;
create trigger arkaphoto_imagenes_hereda
  before insert on public.arkaphoto_imagenes
  for each row execute function public.arkaphoto_imagen_hereda_clasif();

-- Relleno inicial
update public.arkaphoto_imagenes i set clasif_id = l.clasif_id
  from public.arkaphoto_lotes l
 where l.user_id = i.user_id and l.lote = i.lote and i.clasif_id is distinct from l.clasif_id;

grant select, insert, update, delete on public.arkaphoto_imagenes to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (8, '08_clasif_por_foto', 'v0.7.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.12 · ¿mig 08 aplicada? (esperado: columna clasif_id en imagenes · 2 triggers · fotos sin clasif = fotos de lotes sin clasif)
-- select 'columna' tipo, column_name valor from information_schema.columns where table_name='arkaphoto_imagenes' and column_name='clasif_id'
-- union all select 'trigger', tgname from pg_trigger where tgname in ('arkaphoto_lotes_propaga','arkaphoto_imagenes_hereda')
-- union all select 'fotos clasificadas', count(*)::text from public.arkaphoto_imagenes where clasif_id is not null
-- order by 1,2;
-- ------------------------------------------------------------
