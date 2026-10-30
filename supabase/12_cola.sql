-- ============================================================
-- ARKAPHOTO · migración 12 · cola persistente de URLs a traer
-- Versión de app asociada: v0.13.0
-- Fecha: 2026-10-30 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada (complementa /api/traer para listas grandes)
-- Requiere: migraciones 01..11 aplicadas
-- Idempotente: sí
-- Verificación: 3010.3 (al final)
-- ============================================================

create table if not exists public.arkaphoto_cola (
  id           bigint generated always as identity primary key,
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  url          text not null,
  lote         text not null,
  seq          smallint not null check (seq between 1 and 32),
  ext          text not null,
  nombre       text not null,
  estado       text not null default 'pendiente' check (estado in ('pendiente','procesando','traida','existe','error')),
  http_status  smallint,
  error        text,
  intentos     smallint not null default 0,
  bytes        bigint,
  origen_archivo text,
  creado_en    timestamptz not null default now(),
  procesado_en timestamptz,
  unique (user_id, lote, seq)
);
create index if not exists arkaphoto_cola_pend on public.arkaphoto_cola (user_id, estado, id);
alter table public.arkaphoto_cola enable row level security;
drop policy if exists "cola propia" on public.arkaphoto_cola;
create policy "cola propia" on public.arkaphoto_cola
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert, update, delete on public.arkaphoto_cola to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Resumen por estado (una fila por estado) para la UI
create or replace function public.arkaphoto_cola_resumen()
returns table (estado text, n bigint, bytes bigint) language sql security invoker set search_path = public as $$
  select estado, count(*), coalesce(sum(bytes),0) from public.arkaphoto_cola where user_id = auth.uid() group by estado;
$$;
grant execute on function public.arkaphoto_cola_resumen() to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (12, '12_cola', 'v0.13.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 3010.3 · ¿mig 12 aplicada? (esperado: tabla arkaphoto_cola · función arkaphoto_cola_resumen · DML authenticated)
-- select 'tabla' tipo, table_name valor from information_schema.tables where table_name='arkaphoto_cola'
-- union all select 'funcion', proname from pg_proc where proname='arkaphoto_cola_resumen'
-- union all select 'grant', string_agg(privilege_type,',' order by 1) from information_schema.role_table_grants
--   where table_name='arkaphoto_cola' and grantee='authenticated' and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
-- order by 1;
-- ------------------------------------------------------------
