-- ============================================================
-- ARKAPHOTO · migración 03 · seguridad: bucket privado + registro de migraciones
-- Versión de app asociada: v0.3.0
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: policy "arkaphoto lectura publica" (eliminada; vigente = "arkaphoto lee propio")
-- Requiere: migraciones 01..02 aplicadas
-- Idempotente: sí
-- Verificación: 2910.3 (al final)
-- ============================================================

-- 1. Registro de migraciones (lo lee /api/version y el bloque Sistema)
create table if not exists public.arkaphoto_migraciones (
  num         smallint primary key,
  nombre      text not null,
  version     text,
  aplicada_en timestamptz not null default now()
);
alter table public.arkaphoto_migraciones enable row level security;
drop policy if exists "migraciones lectura" on public.arkaphoto_migraciones;
create policy "migraciones lectura" on public.arkaphoto_migraciones
  for select to authenticated using (true);

insert into public.arkaphoto_migraciones (num, nombre, version) values
  (1, '01_inicial',   'v0.1.0'),
  (2, '02_otp',       'v0.2.0'),
  (3, '03_seguridad', 'v0.3.0')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

-- 2. Bucket privado: la lectura pasa a URLs firmadas que pide la app con sesión
update storage.buckets set public = false where id = 'arkaphoto';

drop policy if exists "arkaphoto lectura publica" on storage.objects;
drop policy if exists "arkaphoto lee propio" on storage.objects;
create policy "arkaphoto lee propio" on storage.objects
  for select to authenticated
  using (bucket_id = 'arkaphoto' and (storage.foldername(name))[1] = auth.uid()::text);

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.3 · ¿mig 03 aplicada? (esperado: public=false · 3 filas en migraciones ·
--          policies de storage: actualiza propio, borra propio, escribe propio, lee propio)
-- select 'bucket' tipo, public::text valor from storage.buckets where id='arkaphoto'
-- union all select 'migraciones', count(*)::text from public.arkaphoto_migraciones
-- union all select 'policy', policyname from pg_policies
--   where schemaname='storage' and tablename='objects' and policyname like 'arkaphoto%'
-- order by 1,2;
-- ------------------------------------------------------------
