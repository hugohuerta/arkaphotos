-- ============================================================
-- ARKAPHOTO · migración 07 · tags por lote
-- Versión de app asociada: v0.6.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..06 aplicadas
-- Idempotente: sí
-- Verificación: 2910.11 (al final)
-- ============================================================

create table if not exists public.arkaphoto_tags (
  id        bigint generated always as identity primary key,
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  nombre    text not null check (length(trim(nombre)) between 1 and 40),
  creado_en timestamptz not null default now()
);
create unique index if not exists arkaphoto_tags_unico on public.arkaphoto_tags (user_id, lower(nombre));
alter table public.arkaphoto_tags enable row level security;
drop policy if exists "tags propios" on public.arkaphoto_tags;
create policy "tags propios" on public.arkaphoto_tags
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.arkaphoto_lote_tags (
  user_id   uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lote      text not null,
  tag_id    bigint not null references public.arkaphoto_tags(id) on delete cascade,
  creado_en timestamptz not null default now(),
  primary key (user_id, lote, tag_id)
);
create index if not exists arkaphoto_lote_tags_tag on public.arkaphoto_lote_tags (user_id, tag_id);
alter table public.arkaphoto_lote_tags enable row level security;
drop policy if exists "lote_tags propios" on public.arkaphoto_lote_tags;
create policy "lote_tags propios" on public.arkaphoto_lote_tags
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.arkaphoto_tags, public.arkaphoto_lote_tags to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (7, '07_tags', 'v0.6.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.11 · ¿mig 07 aplicada? (esperado: 2 tablas con DML para authenticated)
-- select table_name, string_agg(privilege_type,',' order by 1) from information_schema.role_table_grants
-- where table_schema='public' and table_name in ('arkaphoto_tags','arkaphoto_lote_tags') and grantee='authenticated'
--   and privilege_type in ('SELECT','INSERT','UPDATE','DELETE') group by 1 order by 1;
-- ------------------------------------------------------------
