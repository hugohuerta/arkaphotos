-- ============================================================
-- ARKAPHOTO · migración 04 · grants explícitos sobre tablas arkaphoto_*
-- Versión de app asociada: v0.3.2
-- Fecha: 2026-10-29 · Chat: ARKAPHOTO — organizador de lotes
-- Reemplaza: nada (01–03 no otorgaban privilegios; este proyecto no los da por default)
-- Requiere: migraciones 01..03 aplicadas
-- Idempotente: sí
-- Verificación: 2910.8 (al final)
-- ============================================================

-- Tablas de datos del usuario: RLS decide la fila; estos grants permiten la operación
grant select, insert, update, delete on public.arkaphoto_config   to authenticated, service_role;
grant select, insert, update, delete on public.arkaphoto_imagenes to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- Códigos de acceso: solo el servidor (service_role); authenticated/anon sin acceso
grant select, insert, update, delete on public.arkaphoto_otp to service_role;

-- Registro de migraciones: lectura con sesión, escritura solo servidor
grant select on public.arkaphoto_migraciones to authenticated;
grant select, insert, update, delete on public.arkaphoto_migraciones to service_role;

-- Futuras tablas creadas por postgres en public: mismos defaults que un proyecto Supabase estándar
alter default privileges for role postgres in schema public grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges for role postgres in schema public grant usage, select on sequences to authenticated, service_role;

insert into public.arkaphoto_migraciones (num, nombre, version) values (4, '04_grants', 'v0.3.2')
on conflict (num) do update set nombre = excluded.nombre, version = excluded.version;

notify pgrst, 'reload schema';

-- ------------------------------------------------------------
-- 2910.8 · ¿mig 04 aplicada? (esperado: service_role con DELETE,INSERT,SELECT,UPDATE en las 4 tablas;
--          authenticated con las 4 en config e imagenes, solo SELECT en migraciones, nada DML en otp)
-- select table_name, grantee, string_agg(privilege_type, ',' order by privilege_type) privs
-- from information_schema.role_table_grants
-- where table_schema='public' and table_name like 'arkaphoto_%' and grantee in ('authenticated','service_role')
--   and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')
-- group by 1,2 order by 1,2;
-- ------------------------------------------------------------
