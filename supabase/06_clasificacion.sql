-- ============================================================
-- ARKAPHOTO · migración 06 · clasificación de galerías (3 niveles) y metadatos de lote
-- Versión de app asociada: v0.5.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada
-- Requiere: migraciones 01..05 aplicadas
-- Idempotente: sí
-- Verificación: 2910.10 (al final)
-- ============================================================

-- Árbol de clasificación: nivel 1 = Tipo, 2 = Subgrupo, 3 = Detalle
create table if not exists public.arkaphoto_clasif (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id  bigint references public.arkaphoto_clasif(id) on delete restrict,
  nivel      smallint not null check (nivel between 1 and 3),
  nombre     text not null check (length(trim(nombre)) between 1 and 60),
  orden      smallint not null default 0,
  creado_en  timestamptz not null default now()
);
create unique index if not exists arkaphoto_clasif_unico on public.arkaphoto_clasif (user_id, coalesce(parent_id, 0), lower(nombre));
create index if not exists arkaphoto_clasif_parent on public.arkaphoto_clasif (user_id, parent_id);
alter table public.arkaphoto_clasif enable row level security;
drop policy if exists "clasif propia" on public.arkaphoto_clasif;
create policy "clasif propia" on public.arkaphoto_clasif
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Metadatos por lote (la clave completa <ts>-<hash> sigue siendo el identificador)
create table if not exists public.arkaphoto_lotes (
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lote        text not null,
  nombre      text check (nombre is null or length(trim(nombre)) <= 60),
  clasif_id   bigint references public.arkaphoto_clasif(id) on delete set null,
  notas       text,
  creado_en   timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  primary key (user_id, lote)
);
alter table public.arkaphoto_lotes enable row level security;
drop policy if exists "lotes propios" on public.arkaphoto_lotes;
create policy "lotes propios" on public.arkaphoto_lotes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.arkaphoto_clasif, public.arkaphoto_lotes to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Tipos iniciales para cada usuario existente (editables desde Admin)
insert into public.arkaphoto_clasif (user_id, nivel, nombre, orden)
select u.id, 1, t.nombre, t.orden
from auth.users u
cross join (values ('Persona',1),('Grupo',2),('Lugar',3),('Evento',4),('Mascota',5),('Objeto',6),('Concepto',7)) as t(nombre, orden)
on conflict do nothing;

insert into public.arkaphoto_migraciones (num, nombre, version) values (6, '06_clasificacion', 'v0.5.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.10 · ¿mig 06 aplicada? (esperado: 2 tablas · 7 tipos por usuario · grants DML a authenticated en ambas)
-- select 'tabla' tipo, table_name valor from information_schema.tables where table_schema='public' and table_name in ('arkaphoto_clasif','arkaphoto_lotes')
-- union all select 'tipos', count(*)::text from public.arkaphoto_clasif where nivel=1
-- union all select 'grant', table_name||':'||string_agg(privilege_type,',' order by 1) from information_schema.role_table_grants
--   where table_schema='public' and table_name in ('arkaphoto_clasif','arkaphoto_lotes') and grantee='authenticated' group by table_name
-- order by 1,2;
-- ------------------------------------------------------------
