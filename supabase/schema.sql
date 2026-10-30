-- ARKAPHOTO · esquema inicial (ejecutar en Supabase → SQL Editor)

-- Configuración por usuario
create table if not exists public.arkaphoto_config (
  user_id      uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  ruta_publica text,
  rango        text not null default '16' check (rango in ('16','32')),
  actualizado  timestamptz not null default now()
);
alter table public.arkaphoto_config enable row level security;
drop policy if exists "config propia" on public.arkaphoto_config;
create policy "config propia" on public.arkaphoto_config
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Imágenes (una fila por posición del lote)
create table if not exists public.arkaphoto_imagenes (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  lote       text not null,                         -- "<ts>-<hash>"
  seq        smallint not null check (seq between 1 and 32),
  ext        text not null,
  nombre     text not null,                         -- "<ts>-<hash>-<seq>.<ext>"
  ruta       text not null,                         -- path dentro del bucket
  bytes      bigint,
  origen     text not null check (origen in ('subida','traida')),
  creado_en  timestamptz not null default now(),
  unique (user_id, lote, seq)
);
create index if not exists arkaphoto_imagenes_user_lote on public.arkaphoto_imagenes (user_id, lote);
alter table public.arkaphoto_imagenes enable row level security;
drop policy if exists "imagenes propias" on public.arkaphoto_imagenes;
create policy "imagenes propias" on public.arkaphoto_imagenes
  for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Bucket: lectura pública, escritura solo en la carpeta del dueño (<uid>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('arkaphoto', 'arkaphoto', true, 52428800, array['image/jpeg','image/png'])
on conflict (id) do update set public = excluded.public;

drop policy if exists "arkaphoto lectura publica" on storage.objects;
create policy "arkaphoto lectura publica" on storage.objects
  for select to public using (bucket_id = 'arkaphoto');

drop policy if exists "arkaphoto escribe propio" on storage.objects;
create policy "arkaphoto escribe propio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'arkaphoto' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "arkaphoto actualiza propio" on storage.objects;
create policy "arkaphoto actualiza propio" on storage.objects
  for update to authenticated
  using (bucket_id = 'arkaphoto' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "arkaphoto borra propio" on storage.objects;
create policy "arkaphoto borra propio" on storage.objects
  for delete to authenticated
  using (bucket_id = 'arkaphoto' and (storage.foldername(name))[1] = auth.uid()::text);
