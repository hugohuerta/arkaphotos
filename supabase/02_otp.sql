-- ARKAPHOTO · códigos de acceso (OTP propio enviado por Resend)
-- Solo lo toca el servidor con service_role: RLS activo y sin políticas.
create table if not exists public.arkaphoto_otp (
  email       text primary key,
  code_hash   text not null,
  expires_at  timestamptz not null,
  attempts    smallint not null default 0,
  sent_at     timestamptz not null default now()
);
alter table public.arkaphoto_otp enable row level security;
